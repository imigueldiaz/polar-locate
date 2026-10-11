import { NativeModule, requireNativeModule } from 'expo';

import type { GrayFrame, LensInfo, ManualSettings } from './PolarCamera.types';

declare class PolarCameraModule extends NativeModule<{ onFrame: (frame: GrayFrame) => void }> {
  /** Enumerates the device's cameras with the capability ranges the UI needs. */
  listLensesAsync(): Promise<LensInfo[]>;
  /** Captures a JPEG into the app cache and resolves with its absolute path. */
  takePictureAsync(): Promise<string>;
  /** Applies manual ISO / exposure time / infinity focus to the live session. */
  setManualAsync(settings: ManualSettings): Promise<void>;
}

export default requireNativeModule<PolarCameraModule>('PolarCamera');
