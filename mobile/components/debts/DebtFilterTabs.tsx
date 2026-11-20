import React from 'react';
import { useTheme } from '../../services/theme';
import { Segmented, SegmentedItem } from '../ui/Segmented';

export type DebtFilter = 'all' | 'debt' | 'receivable' | 'settled';

interface DebtFilterTabsProps {
  value: DebtFilter;
  onChange: (value: DebtFilter) => void;
}

export function DebtFilterTabs({ value, onChange }: DebtFilterTabsProps) {
  const { colors } = useTheme();
  const filterItems: ReadonlyArray<SegmentedItem<DebtFilter>> = [
    { key: 'all', label: 'Semua' },
    { key: 'debt', label: 'Hutang', dotColor: colors.debt },
    { key: 'receivable', label: 'Piutang', dotColor: colors.receivable },
    { key: 'settled', label: 'Lunas' },
  ];
  return (
    <Segmented items={filterItems} value={value} onChange={onChange} label="Filter hutang dan piutang" />
  );
}