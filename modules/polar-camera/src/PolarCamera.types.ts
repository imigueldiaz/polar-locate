// Types shared by the JS side of the PolarCamera native module (Android).

export type LensFacing = 'front' | 'back' | 'external' | 'unknown';

/** One grayscale analysis frame: `gray` is base64 of `width × height` 8-bit samples. */
export type GrayFrame = {
  gray: string;
  width: number;
  height: number;
};

export type LensInfo = {
  /** Camera id usable with the view's `lensId` prop (Camera2 id). */
  id: string;
  facing: LensFacing;
  /** Focal lengths in mm for this camera id. */
  focalLengths: number[];
  /** True for a logical (multi-camera) device that bundles several physical lenses. */
  isLogical: boolean;
  /** Physical sub-camera ids (API 28+, empty otherwise). */
  physicalIds: string[];
  /** Diopters: 0 means fixed focus at infinity. */
  minFocusDistance: number;
  /** Physical sensor width in mm (SENSOR_INFO_PHYSICAL_SIZE); 0 when unavailable. */
  sensorWidthMm: number;
  /** Native sensor resolution in megapixels (SENSOR_INFO_PIXEL_ARRAY_SIZE); 0 when unavailable. */
  pixelArrayMp: number;
  /** Largest JPEG the default stream map offers, in megapixels. */
  maxJpegMp: number;
  /** Largest JPEG in the "maximum resolution" pixel mode (50/200 MP modes); 0 when unavailable. */
  maxResJpegMp: number;
  /** True when the device reports REQUEST_AVAILABLE_CAPABILITIES_ULTRA_HIGH_RESOLUTION_SENSOR. */
  ultraHighRes: boolean;
  /** [min, max] ISO. Doubles because JS has no ints. */
  isoRange: [number, number];
  /** [min, max] exposure time in nanoseconds. */
  exposureTimeRangeNs: [number, number];
};

/** Manual camera settings; `0`/false means "let the camera choose". */
export type ManualSettings = {
  /** SENSOR_SENSITIVITY; applied together with `exposureSec`. */
  iso: number;
  /** Exposure time in seconds; applied together with `iso`. */
  exposureSec: number;
  /** Locks focus at infinity (AF off, focus distance 0). */
  infinityFocus: boolean;
};
