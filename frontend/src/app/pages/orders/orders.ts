import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Customer, Food, Order } from '../../models/types';
import { ApiService } from '../../services/api';

@Component({
  selector: 'app-orders',
  imports: [CommonModule, FormsModule],
  templateUrl: './orders.html',
})
export class OrdersPage {
  private api = inject(ApiService);
  orders = signal<Order[]>([]);
  customers = signal<Customer[]>([]);
  foods = signal<Food[]>([]);
  notice = signal('');
  isError = signal(false);
  busy = signal(false);
  creating = signal(false);
  customerId: number | null = null;
  foodId: number | null = null;
  quantity = 1;

  constructor() {
    void this.load();
    void this.loadOptions();
  }

  async load() {
    try {
      this.orders.set(await this.api.orders());
    } catch (e) {
      this.showError((e as Error).message);
    }
  }

  async loadOptions() {
    try {
      const [c, f] = await Promise.all([this.api.customers(), this.api.foods()]);
      this.customers.set(c);
      this.foods.set(f);
    } catch (e) {
      this.showError((e as Error).message);
    }
  }

  queuedCount() {
    return this.orders().filter((o) => o.status === 'queued').length;
  }

  boxCount() {
    return this.orders().reduce((sum, o) => sum + o.total_boxes, 0);
  }

  sales() {
    return this.orders().reduce((sum, o) => sum + o.total_sales, 0);
  }

  statusLabel(status: string) {
    return status === 'queued'
      ? 'รอจัดส่ง'
      : status === 'simulated'
        ? 'จำลอง'
        : status === 'shipped'
          ? 'จัดส่งแล้ว'
          : status === 'cancelled'
            ? 'ยกเลิก'
            : 'รับจัดส่งแล้ว';
  }

  selectedPrice() {
    return this.foods().find((f) => f.food_id === this.foodId)?.price ?? 0;
  }

  openCreate() {
    this.customerId = this.customers()[0]?.customer_id ?? null;
    this.foodId = this.foods()[0]?.food_id ?? null;
    this.quantity = 1;
    this.notice.set('');
    this.creating.set(true);
  }

  closeCreate() {
    this.creating.set(false);
  }

  async create() {
    if (!this.customerId || !this.foodId) return;
    this.busy.set(true);
    try {
      await this.api.createOrder(this.customerId, this.foodId, this.quantity);
      this.closeCreate();
      await this.load();
      this.showSuccess('สร้างออเดอร์เรียบร้อยแล้ว');
    } catch (e) {
      this.notice.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async change(order: Order, item: Order['items'][number], step: number) {
    const quantity = item.quantity + step;
    if (quantity < 1 || quantity > 3) return;
    this.busy.set(true);
    try {
      await this.api.updateQuantity(order.order_id, item.food_id, quantity);
      await this.load();
      this.showSuccess(`แก้จำนวน ${item.food_name} เป็น ${quantity} กล่องแล้ว`);
    } catch (e) {
      this.showError((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async remove(order: Order) {
    if (!confirm(`ลบออเดอร์ #${order.order_id} ของ ${order.customer_name}?`)) return;
    try {
      await this.api.deleteOrder(order.order_id);
      await this.load();
      this.showSuccess('ลบออเดอร์เรียบร้อย');
    } catch (e) {
      this.showError((e as Error).message);
    }
  }

  async simulate() {
    this.busy.set(true);
    try {
      const result = await this.api.simulate(20);
      await this.load();
      this.showSuccess(`สร้างออเดอร์จำลอง ${result.created_count} รายการแล้ว`);
    } catch (e) {
      this.showError((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  async clearSimulated() {
    if (!confirm('ลบออเดอร์ที่สร้างจากการจำลองทั้งหมด?')) return;
    this.busy.set(true);
    try {
      const result = await this.api.clearSimulated();
      await this.load();
      this.showSuccess(`ลบออเดอร์จำลอง ${result.deleted_count} รายการแล้ว`);
    } catch (e) {
      this.showError((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }

  showError(message: string) {
    this.isError.set(true);
    this.notice.set(message);
  }

  showSuccess(message: string) {
    this.isError.set(false);
    this.notice.set(message);
  }
}
