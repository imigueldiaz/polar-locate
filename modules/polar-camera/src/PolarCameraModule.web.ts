import { registerWebModule, NativeModule } from 'expo';

// PolarCameraModule is not available on the web platform.
class PolarCameraModule extends NativeModule<Record<string, never>> {}

export default registerWebModule(PolarCameraModule, 'PolarCameraModule');
