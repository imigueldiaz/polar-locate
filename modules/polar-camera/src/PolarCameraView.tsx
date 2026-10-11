import { requireNativeView } from 'expo';
import type { ViewProps } from 'react-native';

export type PolarCameraViewProps = ViewProps & {
  /** False unbinds the camera, which releases the lens for other apps. */
  isActive?: boolean;
  /** Camera id from `listLensesAsync()`; null/absent = back-facing default. */
  lensId?: string | null;
  /** CameraX zoom ratio (1 = widest of the selected camera). */
  zoom?: number;
};

const NativePolarCamera = requireNativeView<PolarCameraViewProps>('PolarCamera');

export function PolarCameraView(props: PolarCameraViewProps) {
  return <NativePolarCamera {...props} />;
}
