package expo.modules.polarcamera

import android.content.Context
import android.hardware.camera2.CaptureRequest
import android.util.Log
import android.util.Size
import android.view.ViewGroup
import androidx.camera.camera2.interop.Camera2CameraControl
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.CaptureRequestOptions
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageProxy
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.Promise
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** CameraX preview surface with lens (`lensId`) and zoom control, bound to the activity. */
class PolarCameraView(
  context: Context,
  appContext: AppContext,
) : ExpoView(context, appContext) {
  private val previewView = PreviewView(context).apply {
    // A SurfaceView (the default) is composited outside the RN view hierarchy — and outside
    // adb screencap — so the preview shows black; COMPATIBLE renders through a TextureView.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }
  private val imageCapture by lazy {
    ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
  }
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var isActive = false
  private var lensId: String? = null
  private var zoom = 1f

  /** Which session is bound; stops prop updates from tearing it down mid-capture. */
  private var boundKey: String? = null

  // ExpoView defaults to false, so Yoga never re-lays out the PreviewView child (RN #17968)
  // and it stays 0x0: no surface, so CameraX fails with "Failed to get Surfaces: surfaces=[]".
  override val shouldUseAndroidLayout = true

  /** Grayscale frames from the analysis stream, downscaled; set by the module to emit to JS. */
  var frameSink: ((ByteArray, Int, Int) -> Unit)? = null
  private var analyzer: ExecutorService? = null
  private var lastEmitMs = 0L

  init {
    addView(previewView, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener(
      { provider = future.get(); bindIfNeeded() },
      ContextCompat.getMainExecutor(context),
    )
  }

  fun setActive(active: Boolean) {
    if (active == isActive) return
    isActive = active
    bindIfNeeded()
  }

  fun setLensId(id: String?) {
    if (id == lensId) return
    lensId = id
    bindIfNeeded()
  }

  fun setZoom(value: Float) {
    zoom = value
    applyZoom()
  }

  /** React re-sends props on every render: re-apply the zoom, never rebind. */
  fun updateProps() = applyZoom()

  /**
   * Manual camera control through Camera2 interop. `iso`/`exposureSec` must both be > 0 (AE is
   * switched off for manual exposure); `infinityFocus` locks AF off at focus distance 0.
   */
  @OptIn(ExperimentalCamera2Interop::class)
  fun setManual(iso: Int, exposureSec: Double, infinityFocus: Boolean, focusDistance: Double = -1.0) {
    val control = camera?.cameraControl ?: return
    val options = CaptureRequestOptions.Builder()
    // focusDistance >= 0 comes from the focus sweep; -1 just honours the infinity toggle.
    if (infinityFocus || focusDistance >= 0.0) {
      options.setCaptureRequestOption(
        CaptureRequest.CONTROL_AF_MODE,
        CaptureRequest.CONTROL_AF_MODE_OFF,
      )
      options.setCaptureRequestOption(
        CaptureRequest.LENS_FOCUS_DISTANCE,
        if (focusDistance >= 0.0) focusDistance.toFloat() else 0f,
      )
    }
    if (iso > 0 && exposureSec > 0) {
      options.setCaptureRequestOption(
        CaptureRequest.CONTROL_AE_MODE,
        CaptureRequest.CONTROL_AE_MODE_OFF,
      )
      options.setCaptureRequestOption(CaptureRequest.SENSOR_SENSITIVITY, iso)
      options.setCaptureRequestOption(
        CaptureRequest.SENSOR_EXPOSURE_TIME,
        (exposureSec * 1e9).toLong(),
      )
    }
    Log.i(TAG, "manual iso=$iso exposure=${exposureSec}s infinity=$infinityFocus")
    try {
      Camera2CameraControl.from(control).setCaptureRequestOptions(options.build())
    } catch (e: Exception) {
      Log.e(TAG, "setManual failed", e)
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    if (w > 0 && h > 0) bindIfNeeded()
  }

  override fun onDetachedFromWindow() {
    // A session that outlives the view keeps the camera "unavailable" for the next bind,
    // which shows up as a black preview and captures that never complete.
    Log.i(TAG, "detached: releasing camera")
    provider?.unbindAll()
    camera = null
    boundKey = null
    super.onDetachedFromWindow()
  }

  private fun applyZoom() {
    camera?.cameraControl?.setZoomRatio(zoom.coerceIn(1f, MAX_ZOOM))
  }

  /** Binds or releases the session, but only when the wanted camera actually changed. */
  private fun bindIfNeeded() {
    val p = provider ?: return
    val owner = appContext.currentActivity as? LifecycleOwner ?: return
    if (width <= 0 || height <= 0) {
      // Binding before the first layout leaves CameraX without surfaces: black preview and
      // captures that never complete. Wait for a size instead.
      Log.i(TAG, "bind deferred: view=${width}x$height")
      postDelayed({ if (isActive) bindIfNeeded() }, SIZE_RETRY_MS)
      return
    }
    val key = "$isActive|$lensId"
    if (key == boundKey) return
    boundKey = key
    p.unbindAll()
    if (!isActive) {
      camera = null
      return
    }
    val wanted = lensId
    val selector = CameraSelector.Builder().apply {
      requireLensFacing(CameraSelector.LENS_FACING_BACK)
      if (wanted != null) {
        // Address a camera by its Camera2 id. shortcut: only ids CameraX exposes show up here;
        // physical-only sub-cameras would need Camera2Interop on the capture request.
        addCameraFilter { infos ->
          infos.filter { Camera2CameraInfo.from(it).cameraId == wanted }.toMutableList()
        }
      }
    }.build()
    val preview = Preview.Builder().build().also {
      it.setSurfaceProvider(previewView.surfaceProvider)
    }
    // Real-time detection: the analyzer hands the JS side a downscaled grayscale frame, so the
    // CV no longer needs a full JPEG capture + decode per tick.
    val exec = analyzer ?: Executors.newSingleThreadExecutor().also { analyzer = it }
    val analysis = ImageAnalysis.Builder()
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setTargetResolution(Size(ANALYSIS_WIDTH, ANALYSIS_HEIGHT))
      .build()
      .also { a ->
        a.setAnalyzer(exec) { image: ImageProxy ->
          try {
            val now = System.currentTimeMillis()
            if (now - lastEmitMs >= FRAME_INTERVAL_MS) {
              lastEmitMs = now
              frameSink?.invoke(
                grayOf(image),
                image.width / analysisStep(image.width),
                image.height / analysisStep(image.width),
              )
            }
          } catch (e: Exception) {
            Log.e(TAG, "analyzer failed", e)
          } finally {
            image.close()
          }
        }
      }
    // Preview + a full-res JPEG ImageCapture + an ImageAnalysis YUV stream were all requested;
    // on this device the HAL rejected that combination and CameraX ended up without surfaces
    // (black preview, captures that never complete). Re-add analysis once the combo is proven.
    camera = try {
      p.bindToLifecycle(owner, selector, preview, imageCapture, analysis).also {
        Log.i(
          TAG,
          "bound key=$key lens=$wanted state=${owner.lifecycle.currentState} " +
            "type=${it.cameraInfo.implementationType}",
        )
      }
    } catch (e: Exception) {
      Log.e(TAG, "bind failed key=$key", e)
      null
    }
    applyZoom()
  }

  /** Saves the current frame as JPEG into the app cache and resolves with its absolute path. */
  fun capture(promise: Promise, attempt: Int = 0) {
    if (camera == null && attempt < RETRY_LIMIT) {
      postDelayed({ capture(promise, attempt + 1) }, RETRY_DELAY_MS)
      return
    }
    // CameraX APIs belong on the main thread; the JS call arrives on the JS queue.
    post { captureOnMain(promise) }
  }

  private fun captureOnMain(promise: Promise) {
    val ctx = context.applicationContext
    val file = File(ctx.cacheDir, "polar-${System.currentTimeMillis()}.jpg")
    Log.i(TAG, "capture camera=${camera != null} view=${width}x${height} preview=${previewView.width}x${previewView.height} attached=$isAttachedToWindow -> ${file.name}")
    try {
      imageCapture.takePicture(
        ImageCapture.OutputFileOptions.Builder(file).build(),
        ContextCompat.getMainExecutor(ctx),
        object : ImageCapture.OnImageSavedCallback {
          override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
            Log.i(TAG, "saved ${file.absolutePath} exists=${file.exists()}")
            promise.resolve(file.absolutePath)
          }

          override fun onError(exception: ImageCaptureException) {
            Log.e(TAG, "takePicture error", exception)
            promise.reject("E_CAPTURE", exception.message ?: "capture failed", exception)
          }
        },
      )
    } catch (e: Exception) {
      // Thrown when nothing is bound yet (view inactive or camera not ready).
      Log.e(TAG, "takePicture threw", e)
      promise.reject("E_CAPTURE", e.message ?: "capture failed", e)
    }
  }

  /** Downsample factor that keeps an analysis frame at most ANALYSIS_WIDTH wide. */
  private fun analysisStep(width: Int) = maxOf(1, width / ANALYSIS_WIDTH)

  /** Downsampled grayscale: the Y plane of the analysis frame, at most ANALYSIS_WIDTH wide. */
  private fun grayOf(image: ImageProxy): ByteArray {
    val plane = image.planes[0]
    val buf = plane.buffer
    val rowStride = plane.rowStride
    val srcW = image.width
    val srcH = image.height
    val step = analysisStep(srcW)
    val outW = srcW / step
    val outH = srcH / step
    val gray = ByteArray(outW * outH)
    var i = 0
    for (y in 0 until outH) {
      val row = y * step * rowStride
      for (x in 0 until outW) gray[i++] = buf.get(row + x * step)
    }
    return gray
  }

  private companion object {
    const val TAG = "PolarCamera"
    const val MAX_ZOOM = 8f
    const val RETRY_LIMIT = 30
    const val RETRY_DELAY_MS = 100L
    const val SIZE_RETRY_MS = 100L
    const val ANALYSIS_WIDTH = 320
    const val ANALYSIS_HEIGHT = 240
    const val FRAME_INTERVAL_MS = 200L
  }
}
