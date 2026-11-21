/** Tutorial hint step definitions and spotlight target mappings for post-login & new-user guidance. */

import type { TutorialScrollId, TutorialTargetId } from '../services/tutorialTargets';

export type TutorialTabRoute =
  | '/(tabs)'
  | '/(tabs)/add'
  | '/(tabs)/reports'
  | '/(tabs)/me';

export interface TutorialStep {
  id: string;
  badge: string;
  tabIndex: 0 | 1 | 2 | 3;
  tabRoute: TutorialTabRoute;
  scrollId: TutorialScrollId;
  targetId: TutorialTargetId;
  icon: string;
  title: string;
  registerTitle?: string;
  summary: string;
  examples?: readonly string[];
  tip?: string;
}

export interface TutorialSpotlightTab {
  index: 0 | 1 | 2 | 3;
  label: string;
  icon: string;
  targetStepIndex: number;
}

export const TAB_SPOTLIGHT_ITEMS: readonly TutorialSpotlightTab[] = [
  { index: 0, label: 'Beranda', icon: 'book-outline', targetStepIndex: 0 },
  { index: 1, label: 'Catat', icon: 'add-circle-outline', targetStepIndex: 2 },
  { index: 2, label: 'Laporan', icon: 'stats-chart-outline', targetStepIndex: 3 },
  { index: 3, label: 'Saya', icon: 'person-outline', targetStepIndex: 4 },
];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'home-summary',
    badge: 'Beranda',
    tabIndex: 0,
    tabRoute: '/(tabs)',
    scrollId: 'home',
    targetId: 'home.summary',
    icon: 'book-outline',
    title: 'Ringkasan kas & ganti periode',
    registerTitle: 'Selamat datang! Ini ringkasan kasmu',
    summary:
      'Kartu ini merangkum sisa bersih, pemasukan, pengeluaran, dan investasi. Ketuk tombol Hari / Minggu / Bulan di pojok kanan kartu untuk mengganti rentang laporan.',
    tip: 'Tarik layar ke bawah kapan saja untuk menyegarkan saldo dan pengingat cicilan.',
  },
  {
    id: 'home-quick-input',
    badge: 'Catat cepat',
    tabIndex: 0,
    tabRoute: '/(tabs)',
    scrollId: 'home',
    targetId: 'home.quickInput',
    icon: 'flash-outline',
    title: 'Catat transaksi secepat mengetik',
    summary:
      'Ketik langsung jenis dan nominal di kolom ini. Kategori, nama aset kripto/investasi, dan pratinjau langsung muncul sebelum disimpan.',
    examples: ['makan 25000', 'gaji 5jt', 'crypto xrp 150000'],
  },
  {
    id: 'add-form',
    badge: 'Tab Catat',
    tabIndex: 1,
    tabRoute: '/(tabs)/add',
    scrollId: 'add',
    targetId: 'add.type',
    icon: 'add-circle-outline',
    title: 'Pilih jenis & isi form lengkap',
    summary:
      'Gunakan tab Catat jika ingin memilih Pengeluaran, Pemasukan, atau Investasi, lalu atur kategori, nama aset, dan catatan secara manual.',
  },
  {
    id: 'reports-charts',
    badge: 'Tab Laporan',
    tabIndex: 2,
    tabRoute: '/(tabs)/reports',
    scrollId: 'reports',
    targetId: 'reports.stability',
    icon: 'stats-chart-outline',
    title: 'Arus kas pribadi & kurva kestabilan',
    summary:
      'Pantau Arus Kas Operasional, Investasi, dan Hutang lengkap dengan perbandingan periode sebelumnya, kurva kestabilan, dan progres anggaran.',
  },
  {
    id: 'me-features',
    badge: 'Tab Saya',
    tabIndex: 3,
    tabRoute: '/(tabs)/me',
    scrollId: 'me',
    targetId: 'me.features',
    icon: 'layers-outline',
    title: 'Cicilan, anggaran & daftar belanja',
    summary:
      'Atur transaksi berulang otomatis, batas anggaran bulanan per kategori, cicilan dengan notifikasi jatuh tempo, serta rencana Daftar belanja.',
  },
  {
    id: 'me-settings',
    badge: 'Pengaturan & Panduan',
    tabIndex: 3,
    tabRoute: '/(tabs)/me',
    scrollId: 'me',
    targetId: 'me.settings',
    icon: 'shield-checkmark-outline',
    title: 'Keamanan, tema & tautan akun',
    summary:
      'Buka Pengaturan untuk mengaktifkan Kunci aplikasi (PIN/pola/biometrik), tema Light/Dark, serta menautkan Bot Telegram & Google.',
    tip: 'Ketuk "Panduan aplikasi" di sini kapan saja untuk memutar ulang tutorial.',
  },
];

export function resolveStepTitle(step: TutorialStep, isNewUser: boolean): string {
  if (isNewUser && step.registerTitle) {
    return step.registerTitle;
  }
  return step.title;
}
