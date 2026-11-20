import { api } from './api';
import {
  ShoppingListDetail,
  ShoppingListItem,
  ShoppingListRecordExpenseResult,
  ShoppingListSummary,
} from '../types';

export const shoppingListApi = {
  async list(): Promise<ShoppingListSummary[]> {
    const res = await api.get<ShoppingListSummary[]>('/api/shopping-lists');
    return res.data;
  },

  async get(id: number): Promise<ShoppingListDetail> {
    const res = await api.get<ShoppingListDetail>(`/api/shopping-lists/${id}`);
    return res.data;
  },

  async create(payload: {
    title: string;
    budget_amount?: number | null;
    notes?: string | null;
    items?: Array<{
      group_name?: string;
      name: string;
      price?: number | null;
      is_checked?: boolean;
    }>;
  }): Promise<ShoppingListDetail> {
    const res = await api.post<ShoppingListDetail>('/api/shopping-lists', payload);
    return res.data;
  },

  async update(
    id: number,
    payload: {
      title?: string;
      budget_amount?: number | null;
      notes?: string | null;
    }
  ): Promise<ShoppingListDetail> {
    const res = await api.put<ShoppingListDetail>(`/api/shopping-lists/${id}`, payload);
    return res.data;
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/api/shopping-lists/${id}`);
  },

  async duplicate(id: number, title?: string): Promise<ShoppingListDetail> {
    const res = await api.post<ShoppingListDetail>(
      `/api/shopping-lists/${id}/duplicate`,
      title ? { title } : {}
    );
    return res.data;
  },

  async addItem(
    listId: number,
    payload: {
      group_name?: string;
      name: string;
      price?: number | null;
      is_checked?: boolean;
    }
  ): Promise<ShoppingListItem> {
    const res = await api.post<ShoppingListItem>(
      `/api/shopping-lists/${listId}/items`,
      payload
    );
    return res.data;
  },

  async updateItem(
    listId: number,
    itemId: number,
    payload: {
      group_name?: string;
      name?: string;
      price?: number | null;
      is_checked?: boolean;
    }
  ): Promise<ShoppingListItem> {
    const res = await api.patch<ShoppingListItem>(
      `/api/shopping-lists/${listId}/items/${itemId}`,
      payload
    );
    return res.data;
  },

  async removeItem(listId: number, itemId: number): Promise<void> {
    await api.delete(`/api/shopping-lists/${listId}/items/${itemId}`);
  },

  async recordExpense(
    listId: number,
    transactionDate?: string
  ): Promise<ShoppingListRecordExpenseResult> {
    const res = await api.post<ShoppingListRecordExpenseResult>(
      `/api/shopping-lists/${listId}/record-expense`,
      transactionDate ? { transaction_date: transactionDate } : {}
    );
    return res.data;
  },
};
