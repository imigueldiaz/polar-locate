package expo.modules.polarcamera

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PolarCameraModule : Module() {
  private var cameraView: PolarCameraView? = null

  override fun definition() = ModuleDefinition {
    Name("PolarCamera")
    Events("onFrame")

    AsyncFunction<List<Map<String, Any?>>>("listLensesAsync") {
      val context = appContext.currentActivity?.applicationContext ?: appContext.reactContext
      val manager = context?.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
        ?: return@AsyncFunction emptyList()
      manager.cameraIdList.map { id -> describe(manager, id) }
    }

    View(PolarCameraView::class) {
      Prop("isActive") { view, isActive: Boolean? -> view.setActive(isActive ?: false) }
      Prop("lensId") { view, lensId: String? -> view.setLensId(lensId) }
      Prop("zoom") { view, zoom: Float? -> view.setZoom(zoom ?: 1f) }
      OnViewDidUpdateProps { view ->
        cameraView = view
        // Frames reach JS as base64 grayscale; the detection math stays in the TS pipeline.
        view.frameSink = { gray, width, height ->
          sendEvent(
            "onFrame",
            mapOf(
              "gray" to Base64.encodeToString(gray, Base64.NO_WRAP),
              "width" to width,
              "height" to height,
            ),
          )
        }
        view.updateProps()
      }
    }

    AsyncFunction("takePictureAsync") { promise: Promise ->
      val view = cameraView
      if (view == null) {
        promise.reject("E_NO_VIEW", "PolarCameraView is not mounted", null)
      } else {
        view.capture(promise)
      }
    }

    AsyncFunction("setManualAsync") { settings: Map<String, Any?> ->
      val view = cameraView ?: return@AsyncFunction
      val iso = (settings["iso"] as? Number)?.toInt() ?: 0
      val exposureSec = (settings["exposureSec"] as? Number)?.toDouble() ?: 0.0
      val infinity = settings["infinityFocus"] as? Boolean ?: false
      view.setManual(iso, exposureSec, infinity)
    }
  }

  /** Largest JPEG the stream map offers, in megapixels (0 when it cannot be read). */
  private fun maxJpegMpFrom(map: android.hardware.camera2.params.StreamConfigurationMap?): Double {
    val sizes = map?.getOutputSizes(android.graphics.ImageFormat.JPEG) ?: return 0.0
    return sizes.maxOfOrNull { it.width.toDouble() * it.height / 1e6 } ?: 0.0
  }

  /** Everything the JS UI needs to list lenses and show the manual-control ranges. */
  private fun describe(manager: CameraManager, id: String): Map<String, Any?> {
    val ch = manager.getCameraCharacteristics(id)
    val facing = when (ch.get(CameraCharacteristics.LENS_FACING)) {
      CameraCharacteristics.LENS_FACING_FRONT -> "front"
      CameraCharacteristics.LENS_FACING_BACK -> "back"
      CameraCharacteristics.LENS_FACING_EXTERNAL -> "external"
      else -> "unknown"
    }
    val capabilities = ch.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES) ?: IntArray(0)
    val isLogical = capabilities.contains(
      CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA
    )
    val physicalIds = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      ch.physicalCameraIds.toList()
    } else {
      emptyList()
    }
    val focalLengths =
      (ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS) ?: FloatArray(0)).toList()
    val minFocusDistance = ch.get(CameraCharacteristics.LENS_INFO_MINIMUM_FOCUS_DISTANCE) ?: 0f
    val pixelArray = ch.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)
    val iso = ch.get(CameraCharacteristics.SENSOR_INFO_SENSITIVITY_RANGE)
    val exposure = ch.get(CameraCharacteristics.SENSOR_INFO_EXPOSURE_TIME_RANGE)
    val physical = ch.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)
    // 50/200 MP modes are the "maximum resolution" pixel mode: the default stream map only
    // lists the binned sizes, so read the max-resolution map (API 31+) as well.
    val maxJpegMp = maxJpegMpFrom(ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP))
    val ultraHighRes = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      capabilities.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_ULTRA_HIGH_RESOLUTION_SENSOR)
    val maxResJpegMp = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      maxJpegMpFrom(ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP_MAXIMUM_RESOLUTION))
    } else {
      0.0
    }
    return mapOf(
      "id" to id,
      "facing" to facing,
      "focalLengths" to focalLengths,
      "isLogical" to isLogical,
      "physicalIds" to physicalIds,
      "minFocusDistance" to minFocusDistance.toDouble(),
      "sensorWidthMm" to (physical?.width?.toDouble() ?: 0.0),
      // Native sensor resolution; what the photo ends up being is the JPEG output size.
      "pixelArrayMp" to (pixelArray?.let { it.width.toDouble() * it.height / 1e6 } ?: 0.0),
      "maxJpegMp" to maxJpegMp,
      "maxResJpegMp" to maxResJpegMp,
      "ultraHighRes" to ultraHighRes,
      "isoRange" to listOf(iso?.lower?.toDouble() ?: 0.0, iso?.upper?.toDouble() ?: 0.0),
      "exposureTimeRangeNs" to
        listOf(exposure?.lower?.toDouble() ?: 0.0, exposure?.upper?.toDouble() ?: 0.0),
    )
  }
}
