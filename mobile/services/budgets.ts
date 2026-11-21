import { api } from './api';
import { Budget, BudgetOverview } from '../types';

export const budgetApi = {
  async getOverview(params?: { year?: number; month?: number }): Promise<BudgetOverview> {
    const res = await api.get<BudgetOverview>('/api/budgets', {
      params,
    });
    return res.data;
  },

  async upsert(payload: {
    category_id?: number | null;
    amount: number;
    alert_threshold?: number;
  }): Promise<Budget> {
    const res = await api.put<Budget>('/api/budgets', {
      category_id: payload.category_id ?? null,
      amount: payload.amount,
      alert_threshold: payload.alert_threshold ?? 80,
    });
    return res.data;
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/api/budgets/${id}`);
  },
};
