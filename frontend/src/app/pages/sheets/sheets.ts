import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Order } from '../../models/types';
import { ApiService } from '../../services/api';
import { DeliveryPlanningService } from '../../services/delivery-planning';

interface WorkSheet {
  workId: number;
  riderId: number | null;
  riderName: string | null;
  color: string;
  orders: Order[];
  totalBoxes: number;
}

const FALLBACK_COLORS = ['#cf5a4c', '#36886b', '#4779bd', '#a264ae', '#d18a36', '#378c9b', '#bd5a86', '#788d43'];

@Component({
  selector: 'app-sheets',
  imports: [CommonModule, RouterLink],
  templateUrl: './sheets.html',
})
export class Sheets {
  private api = inject(ApiService);
  readonly planner = inject(DeliveryPlanningService);
  loading = signal(false);
  error = signal('');
  works = signal<WorkSheet[]>([]);

  constructor() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const currentOrders = await this.api.deliveryOrders();
      // Only orders without a work_id are planned. Previously generated worksheets
      // stay linked to their database IDs and will not be duplicated on refresh.
      const unassignedOrders = currentOrders.filter(
        (order) => order.work_id == null && (order.status === 'queued' || order.status === 'simulated'),
      );
      this.planner.setOrders(unassignedOrders);

      const pendingGroups = this.planner.plan().routes.map((route) => ({
        order_ids: route.orders.map((order) => order.order_id),
        route_color: route.color,
      }));
      // Backend first looks for an active nearby worksheet with spare capacity;
      // it creates a new worksheet only when no rider matches the 1 km / 3-order rules.
      if (pendingGroups.length) await this.api.generateWorks(pendingGroups);

      // Read persisted worksheets from GET /works so the displayed IDs always
      // come from the database rather than being recreated in the browser.
      const savedWorks = await this.api.works();
      this.works.set(savedWorks
        .map((work, index) => {
          // Only show orders that still need delivery. Completed (shipped),
          // cancelled, and otherwise inactive orders remain in the database
          // for history, but do not keep an old worksheet visible.
          const activeOrders = (work.orders ?? []).filter(
            (order) => order.status === 'queued' || order.status === 'simulated',
          );

          return {
            workId: work.work_id,
            riderId: work.rider_id ?? null,
            riderName: work.rider_name ?? null,
            color: work.route_color || FALLBACK_COLORS[index % FALLBACK_COLORS.length] || '#cf5a4c',
            orders: [...activeOrders].sort(
              (a, b) => (a.delivery_queue ?? Number.MAX_SAFE_INTEGER) - (b.delivery_queue ?? Number.MAX_SAFE_INTEGER) || a.order_id - b.order_id,
            ),
            // Recalculate from active orders so shipped/cancelled orders do
            // not inflate the number of boxes shown on the worksheet.
            totalBoxes: activeOrders.reduce((sum, order) => sum + Number(order.total_boxes || 0), 0),
          };
        })
        // Hide worksheets with no remaining deliveries (including worksheets
        // where every order has already been shipped or cancelled).
        .filter((work) => work.orders.length > 0));
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  orderCount() {
    return this.works().reduce((sum, work) => sum + work.orders.length, 0);
  }

  totalBoxes() {
    return this.works().reduce((sum, work) => sum + work.totalBoxes, 0);
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
            : status;
  }

  statusClass(status: string) {
    return {
      simulated: status === 'simulated',
      shipped: status === 'shipped',
      cancelled: status === 'cancelled',
    };
  }

}
