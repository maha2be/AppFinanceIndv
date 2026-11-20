import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Fonts } from '../../utils/theme';
import { useTheme } from '../../services/theme';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const bottom = Platform.OS === 'web' ? 8 : Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.line,
          height: 56 + bottom,
          paddingTop: 6,
          paddingBottom: bottom,
        },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: {
          fontFamily: Fonts.medium,
          fontSize: 10,
          lineHeight: 14,
          marginTop: 2,
        },

      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Beranda',
          tabBarIcon: ({ color }) => <Ionicons name="book-outline" size={21} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: 'Catat',
          tabBarIcon: ({ color }) => <Ionicons name="add-circle-outline" size={21} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Laporan',
          tabBarIcon: ({ color }) => <Ionicons name="stats-chart-outline" size={21} color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Saya',
          tabBarIcon: ({ color }) => <Ionicons name="person-outline" size={21} color={color as string} />,
        }}
      />
    </Tabs>
  );
}
