import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Fonts, Radius, Space } from '../../utils/theme';
import { createThemedStyles, useTheme } from '../../services/theme';
import { User } from '../../types';
import { authApi, describeApiError } from '../../services/auth';
import { PhotoSource, pickProfilePhoto } from '../../services/profilePhoto';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Sheet } from '../ui/Sheet';

interface EditProfileSheetProps {
  visible: boolean;
  user: User | null;
  onClose: () => void;
  onSaved: (user: User) => void;
}

const MAX_NAME_LENGTH = 80;

export function EditProfileSheet({ visible, user, onClose, onSaved }: EditProfileSheetProps) {
  const [name, setName] = useState(user?.first_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatar_url ?? null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const wasVisibleRef = useRef(false);
  const latestUserRef = useRef(user);
  latestUserRef.current = user;

  const theme = useTheme();
  const { colors } = theme;
  const styles = useStyles(theme);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const current = latestUserRef.current;
      setName(current?.first_name ?? '');
      setAvatarUrl(current?.avatar_url ?? null);
      setError(null);
      setPicking(false);
      setSaving(false);
      busyRef.current = false;
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  const busy = picking || saving;
  const initialName = (user?.first_name ?? '').trim();
  const initialAvatar = user?.avatar_url ?? null;
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== initialName;
  const avatarChanged = avatarUrl !== initialAvatar;
  const hasChanges = nameChanged || avatarChanged;

  const handleClose = () => {
    if (busyRef.current || busy) return;
    setError(null);
    onClose();
  };

  const handlePickPhoto = async (source: PhotoSource) => {
    if (busyRef.current || busy) return;
    busyRef.current = true;
    setPicking(true);
    setError(null);
    try {
      const picked = await pickProfilePhoto(source);
      if (!mountedRef.current) return;
      if (picked) {
        setAvatarUrl(picked);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Gagal memilih foto profil.');
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPicking(false);
    }
  };

  const handleRemovePhoto = () => {
    if (busyRef.current || busy || avatarUrl === null) return;
    setError(null);
    setAvatarUrl(null);
  };

  const handleSave = async () => {
    if (busyRef.current || busy) return;
    if (!trimmedName) {
      setError('Nama tidak boleh kosong.');
      return;
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      setError(`Nama maksimal ${MAX_NAME_LENGTH} karakter.`);
      return;
    }
    if (!hasChanges) {
      handleClose();
      return;
    }

    const payload: { first_name?: string; avatar_url?: string | null } = {};
    if (nameChanged) payload.first_name = trimmedName;
    if (avatarChanged) payload.avatar_url = avatarUrl;

    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const updated = await authApi.updateProfile(payload);
      if (!mountedRef.current) return;
      onSaved(updated);
    } catch (err) {
      if (mountedRef.current) {
        setError(describeApiError(err, 'Gagal menyimpan perubahan profil. Coba lagi.'));
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const previewInitial = trimmedName.charAt(0).toUpperCase();

  return (
    <Sheet
      visible={visible}
      onClose={handleClose}
      title="Edit profil"
      footer={
        <>
          <Button
            title="Simpan"
            loading={saving}
            disabled={picking || !hasChanges}
            onPress={handleSave}
            size="lg"
          />
          <Button title="Batal" variant="ghost" onPress={handleClose} disabled={busy} />
        </>
      }
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatarSection}>
          <View
            style={styles.avatarPreview}
            accessible
            accessibilityLabel={avatarUrl ? 'Foto profil saat ini' : 'Inisial profil saat ini'}
          >
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImage} resizeMode="cover" />
            ) : previewInitial ? (
              <Text style={styles.avatarText}>{previewInitial}</Text>
            ) : (
              <Ionicons name="person-outline" size={30} color={colors.inkSoft} />
            )}
          </View>

          <View style={styles.photoActions}>
            <Pressable
              onPress={() => void handlePickPhoto('library')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Pilih foto dari galeri"
              accessibilityState={{ disabled: busy, busy: picking }}
              style={({ pressed }) => [
                styles.photoButton,
                busy && styles.photoButtonDisabled,
                pressed && !busy && styles.photoButtonPressed,
              ]}
            >
              <Ionicons name="images-outline" size={16} color={colors.ink} />
              <Text style={styles.photoButtonText}>Galeri</Text>
            </Pressable>

            <Pressable
              onPress={() => void handlePickPhoto('camera')}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Ambil foto dengan kamera"
              accessibilityState={{ disabled: busy, busy: picking }}
              style={({ pressed }) => [
                styles.photoButton,
                busy && styles.photoButtonDisabled,
                pressed && !busy && styles.photoButtonPressed,
              ]}
            >
              <Ionicons name="camera-outline" size={16} color={colors.ink} />
              <Text style={styles.photoButtonText}>Kamera</Text>
            </Pressable>

            {avatarUrl ? (
              <Pressable
                onPress={handleRemovePhoto}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Hapus foto profil"
                accessibilityState={{ disabled: busy }}
                style={({ pressed }) => [
                  styles.photoButton,
                  styles.removePhotoButton,
                  busy && styles.photoButtonDisabled,
                  pressed && !busy && styles.photoButtonPressed,
                ]}
              >
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.removePhotoText}>Hapus</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Input
          label="Nama"
          placeholder="Masukkan nama panggilan"
          value={name}
          onChangeText={(value) => {
            setName(value);
            if (error) setError(null);
          }}
          editable={!busy}
          maxLength={MAX_NAME_LENGTH}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleSave}
          accessibilityLabel="Nama profil"
        />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    paddingTop: Space.sm,
    paddingBottom: Space.sm,
  },
  avatarSection: {
    alignItems: 'center',
    gap: Space.md,
    marginBottom: Space.lg,
  },
  avatarPreview: {
    width: 88,
    height: 88,
    borderRadius: Radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    fontFamily: Fonts.serif,
    fontSize: 40,
    color: colors.ink,
  },
  photoActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Space.sm,
  },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  removePhotoButton: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerTint,
  },
  photoButtonDisabled: {
    opacity: 0.45,
  },
  photoButtonPressed: {
    opacity: 0.8,
  },
  photoButtonText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  removePhotoText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.danger,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    marginBottom: Space.md,
  },
}));
