import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api';
import { Customer, Food, Order } from '../../models/types';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard.html',
})
export class DashboardPage {
  private api = inject(ApiService);
  customers = signal<Customer[]>([]);
  foods = signal<Food[]>([]);
  orders = signal<Order[]>([]);
  error = signal('');

  boxCount() {
    return this.orders().reduce((sum, item) => sum + item.total_boxes, 0);
  }

  sales() {
    return this.orders().reduce((sum, item) => sum + item.total_sales, 0);
  }

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const [c, f, o] = await Promise.all([this.api.customers(), this.api.foods(), this.api.orders()]);
      this.customers.set(c);
      this.foods.set(f);
      this.orders.set(o);
      this.error.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
