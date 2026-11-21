/** Tutorial hint step definitions and pure helpers for onboarding & post-login guidance. */

export type TutorialTabRoute =
  | '/(tabs)'
  | '/(tabs)/add'
  | '/(tabs)/reports'
  | '/(tabs)/me';

export interface TutorialClue {
  lead: string;
  detail: string;
}

export interface TutorialStep {
  id: string;
  badge: string;
  tabIndex: 0 | 1 | 2 | 3;
  tabRoute: TutorialTabRoute;
  icon: string;
  title: string;
  registerTitle?: string;
  summary: string;
  clues: readonly TutorialClue[];
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
  { index: 1, label: 'Catat', icon: 'add-circle-outline', targetStepIndex: 1 },
  { index: 2, label: 'Laporan', icon: 'stats-chart-outline', targetStepIndex: 2 },
  { index: 3, label: 'Saya', icon: 'person-outline', targetStepIndex: 3 },
];

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'home-summary',
    badge: 'Beranda',
    tabIndex: 0,
    tabRoute: '/(tabs)',
    icon: 'book-outline',
    title: 'Ringkasan kas & aktivitas harian',
    registerTitle: 'Selamat datang di Bot04',
    summary:
      'Halaman Beranda merangkum pemasukan, pengeluaran, investasi, dan transaksi terbaru kamu.',
    clues: [
      {
        lead: 'Ketuk label Hari / Minggu / Bulan',
        detail: 'di pojok kanan kartu ringkasan untuk mengganti rentang laporan langsung.',
      },
      {
        lead: 'Riwayat perubahan & Seluruh Transaksi',
        detail: 'tersedia di bagian bawah untuk mencari transaksi lama atau melihat jejak edit.',
      },
    ],
    tip: 'Tarik layar ke bawah kapan saja untuk menyegarkan saldo dan pengingat cicilan.',
  },
  {
    id: 'quick-input',
    badge: 'Beranda & Tab Catat',
    tabIndex: 1,
    tabRoute: '/(tabs)/add',
    icon: 'flash-outline',
    title: 'Catat transaksi secepat mengetik',
    summary:
      'Gunakan kolom Catat cepat di Beranda untuk input kilat, atau buka tab Catat untuk form lengkap.',
    clues: [
      {
        lead: 'Bahasa sehari-hari otomatis dikenali',
        detail: 'mulai dari jenis transaksi, kategori, hingga nominal singkat seperti 25rb atau 5jt.',
      },
      {
        lead: 'Nama aset / kripto ikut tersimpan',
        detail: 'saat mencatat investasi agar portofolio tetap rapi dan mudah ditinjau.',
      },
    ],
    examples: ['makan 25000', 'gaji 5jt', 'crypto xrp 150000'],
  },
  {
    id: 'reports-charts',
    badge: 'Tab Laporan',
    tabIndex: 2,
    tabRoute: '/(tabs)/reports',
    icon: 'stats-chart-outline',
    title: 'Grafik stabilitas & rincian kategori',
    summary:
      'Pantau kesehatan arus kas dari waktu ke waktu lewat tab Laporan dengan periode harian, mingguan, atau bulanan.',
    clues: [
      {
        lead: 'Kurva Stabilitas Keuangan',
        detail: 'menampilkan ritme pemasukan dan pengeluaran sepanjang periode aktif.',
      },
      {
        lead: 'Diagram kategori',
        detail: 'membantu melihat porsi pengeluaran terbesar dengan cepat.',
      },
    ],
    tip: 'Gunakan tab Laporan secara berkala untuk mengevaluasi pos pengeluaran terbesar.',
  },
  {
    id: 'me-features',
    badge: 'Tab Saya',
    tabIndex: 3,
    tabRoute: '/(tabs)/me',
    icon: 'layers-outline',
    title: 'Cicilan, jadwal rutin & daftar belanja',
    summary:
      'Fitur keuangan lanjutan tersusun di tab Saya agar Beranda tetap ringkas dan nyaman.',
    clues: [
      {
        lead: 'Transaksi berulang',
        detail: 'untuk tagihan, langganan, atau gaji otomatis mingguan dan bulanan.',
      },
      {
        lead: 'Hutang & piutang',
        detail: 'mencatat sisa cicilan lengkap dengan pengingat jatuh tempo H-3, H-1, dan hari-H.',
      },
      {
        lead: 'Daftar belanja',
        detail: 'menyusun rencana belanja per grup tanpa memotong saldo sebelum dicatat ke pengeluaran.',
      },
    ],
  },
  {
    id: 'security-settings',
    badge: 'Saya -> Pengaturan',
    tabIndex: 3,
    tabRoute: '/(tabs)/me',
    icon: 'shield-checkmark-outline',
    title: 'Keamanan, tema & tautan akun',
    summary:
      'Buka Saya lalu ketuk Pengaturan untuk mengamankan aplikasi dan menyesuaikan preferensi.',
    clues: [
      {
        lead: 'Kunci aplikasi',
        detail: 'aktifkan PIN 6 digit, pola gestur, atau biometrik untuk menjaga privasi data.',
      },
      {
        lead: 'Tautkan Telegram & Google',
        detail: 'agar bisa mencatat transaksi langsung lewat Bot Telegram dan masuk lebih cepat.',
      },
      {
        lead: 'Tema Light / Dark & pengingat',
        detail: 'pilih tampilan terang atau gelap serta atur jam notifikasi cicilan.',
      },
    ],
    tip: 'Kamu bisa membuka panduan ini lagi kapan saja lewat Saya -> Panduan aplikasi.',
  },
];

export function resolveStepTitle(step: TutorialStep, isNewUser: boolean): string {
  if (isNewUser && step.registerTitle) {
    return step.registerTitle;
  }
  return step.title;
}
