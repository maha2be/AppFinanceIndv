/** Profile photo selection and compact JPEG normalization for avatar upload. */
import { Platform } from 'react-native';

export type PhotoSource = 'library' | 'camera';

const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 0.72;
const MAX_DATA_URI_LENGTH = 410_000;

function encodeDataUri(base64: string, mimeType = 'image/jpeg'): string {
  const clean = base64.replace(/\s+/g, '');
  const normalizedMime =
    mimeType === 'image/png' || mimeType === 'image/webp' ? mimeType : 'image/jpeg';
  const uri = `data:${normalizedMime};base64,${clean}`;
  if (uri.length > MAX_DATA_URI_LENGTH) {
    throw new Error('Ukuran foto terlalu besar. Pilih foto lain yang lebih kecil.');
  }
  return uri;
}

export async function pickProfilePhoto(source: PhotoSource): Promise<string | null> {
  const ImagePicker = require('expo-image-picker') as typeof import('expo-image-picker');

  if (Platform.OS !== 'web') {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        throw new Error('Izin kamera ditolak. Aktifkan izin kamera di pengaturan perangkat.');
      }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        throw new Error('Izin galeri ditolak. Aktifkan izin foto di pengaturan perangkat.');
      }
    }
  }

  const pickerOptions: import('expo-image-picker').ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
    base64: true,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  try {
    const manipulator = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    if (manipulator?.ImageManipulator?.manipulate) {
      const context = manipulator.ImageManipulator.manipulate(asset.uri);
      const rendered = await context
        .resize({ width: AVATAR_SIZE, height: AVATAR_SIZE })
        .renderAsync();
      const saved = await rendered.saveAsync({
        compress: AVATAR_QUALITY,
        format: manipulator.SaveFormat.JPEG,
        base64: true,
      });
      if (saved.base64) {
        return encodeDataUri(saved.base64, 'image/jpeg');
      }
    }
  } catch {
    // Fall back to the cropped asset payload if manipulator is unavailable.
  }

  if (!asset.base64) {
    throw new Error('Gagal membaca data foto yang dipilih. Coba lagi.');
  }
  return encodeDataUri(asset.base64, asset.mimeType ?? 'image/jpeg');
}
