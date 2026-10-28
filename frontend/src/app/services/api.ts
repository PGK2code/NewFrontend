import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { Customer, Food, Order, WorkRecord } from '../models/types';

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly base = environment.apiUrl;
  readonly online = signal(false);

  constructor(private http: HttpClient) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    try {
      const result = await firstValueFrom(this.http.request<T>(method, `${this.base}${path}`, { body }));
      this.online.set(true);
      return result;
    } catch (error) {
      this.online.set(false);
      const e = error as { error?: { error?: string }; message?: string };
      throw new Error(e.error?.error || e.message || 'เชื่อมต่อ API ไม่สำเร็จ');
    }
  }

  customers() {
    return this.request<Customer[]>('GET', '/customers');
  }

  foods() {
    return this.request<Food[]>('GET', '/foods');
  }

  orders() {
    return this.request<Order[]>('GET', '/orders');
  }

  works() {
    return this.request<WorkRecord[]>('GET', '/works');
  }

  work(workId: number) {
    return this.request<WorkRecord>('GET', `/works/${workId}`);
  }

  markOrderShipped(workId: number, orderId: number) {
    return this.request<{ work_id: number; order_id: number; status: string; message: string }>(
      'POST',
      `/works/${workId}/orders/${orderId}/shipped`,
    );
  }

  async deliveryOrders() {
    const [orders, customers] = await Promise.all([this.orders(), this.customers()]);
    const customerAddresses = new Map(customers.map((customer) => [customer.customer_id, customer.address]));

    // ส่วนของกอล์ฟ: เติมที่อยู่จากข้อมูลลูกค้า กรณี API ออเดอร์ยังไม่มี address
    return orders.map((order) => ({
      ...order,
      address: order.address?.trim() || customerAddresses.get(order.customer_id) || null,
    }));
  }

  generateWorks(works: Array<{ order_ids: number[]; route_color: string }>) {
    return this.request<{ created_count: number; works: Array<{ work_id: number; rider_id: number; order_ids: number[] }> }>(
      'POST',
      '/works/generate',
      { works },
    );
  }

  saveCustomer(data: Omit<Customer, 'customer_id'>, id?: number) {
    return this.request<{ customer_id: number }>(id ? 'PUT' : 'POST', id ? `/customers/${id}` : '/customers', data);
  }

  deleteCustomer(id: number) {
    return this.request<{ message: string }>('DELETE', `/customers/${id}`);
  }

  createOrder(customer_id: number, food_id: number, quantity: number) {
    return this.request<{ order_id: number }>('POST', '/orders', {
      customer_id,
      food_id,
      quantity,
    });
  }

  updateQuantity(id: number, food_id: number, quantity: number) {
    return this.request('PUT', `/orders/${id}/quantity`, { food_id, quantity });
  }

  deleteOrder(id: number) {
    return this.request('DELETE', `/orders/${id}`);
  }

  simulate(count: number) {
    return this.request<{ created_count: number }>('POST', '/orders/simulate', {
      count,
    });
  }

  clearSimulated() {
    return this.request<{ deleted_count: number }>('DELETE', '/orders/simulated');
  }
}
