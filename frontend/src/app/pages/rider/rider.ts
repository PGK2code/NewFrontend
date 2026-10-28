import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Order, WorkRecord } from '../../models/types';
import { ApiService } from '../../services/api';

const ACTIVE_STATUSES = new Set(['queued', 'simulated']);
const DEFAULT_ROUTE_COLOR = '#36886b';

@Component({
  selector: 'app-rider',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './rider.html',
})
export class RiderPage {
  private api = inject(ApiService);

  workId = '';
  loading = signal(false);
  searched = signal(false);
  error = signal('');
  work = signal<WorkRecord | null>(null);
  lastUpdated = signal<Date | null>(null);
  completingOrderId = signal<number | null>(null);
  actionMessage = signal('');

  async search() {
    const normalizedId = this.workId.trim();
    const workId = Number(normalizedId);

    this.error.set('');
    this.actionMessage.set('');
    this.work.set(null);
    this.lastUpdated.set(null);
    this.searched.set(true);

    if (!/^\d+$/.test(normalizedId) || !Number.isSafeInteger(workId) || workId < 1) {
      this.error.set('กรุณากรอกเลขใบงานเป็นตัวเลขจำนวนเต็มที่มากกว่า 0');
      return;
    }

    this.loading.set(true);
    try {
      const result = await this.api.work(workId);
      const activeOrders = (result.orders ?? [])
        .filter((order) => ACTIVE_STATUSES.has(order.status))
        .sort(
          (a, b) =>
            (a.delivery_queue ?? Number.MAX_SAFE_INTEGER) -
              (b.delivery_queue ?? Number.MAX_SAFE_INTEGER) ||
            a.order_id - b.order_id,
        );

      this.work.set({
        ...result,
        route_color: result.route_color || DEFAULT_ROUTE_COLOR,
        orders: activeOrders,
        total_boxes: activeOrders.reduce((sum, order) => sum + Number(order.total_boxes || 0), 0),
        total_sales: activeOrders.reduce((sum, order) => sum + Number(order.total_sales || 0), 0),
      });
      this.lastUpdated.set(new Date());
    } catch (error) {
      const message = (error as Error).message || '';
      this.error.set(
        /worksheet not found/i.test(message)
          ? `ไม่พบใบงานหมายเลข ${workId} กรุณาตรวจสอบเลขใบงานอีกครั้ง`
          : message || 'ไม่สามารถค้นหาใบงานได้ กรุณาลองใหม่อีกครั้ง',
      );
    } finally {
      this.loading.set(false);
    }
  }

  async markDelivered(order: Order) {
    const currentWork = this.work();
    if (!currentWork || this.completingOrderId() !== null) return;

    this.error.set('');
    this.actionMessage.set('');
    this.completingOrderId.set(order.order_id);
    try {
      await this.api.markOrderShipped(currentWork.work_id, order.order_id);
      this.actionMessage.set(`บันทึกออเดอร์ #${order.order_id} ว่าส่งเรียบร้อยแล้ว`);
      await this.search();
      this.actionMessage.set(`บันทึกออเดอร์ #${order.order_id} ว่าส่งเรียบร้อยแล้ว`);
    } catch (error) {
      this.error.set((error as Error).message || 'ไม่สามารถบันทึกสถานะการจัดส่งได้');
    } finally {
      this.completingOrderId.set(null);
    }
  }

  statusLabel(status: string) {
    return status === 'queued' ? 'รอจัดส่ง' : status === 'simulated' ? 'ออเดอร์จำลอง' : status;
  }

  statusClass(status: string) {
    return { simulated: status === 'simulated' };
  }

  orderItems(order: Order) {
    return order.items ?? [];
  }

  mapUrl(order: Order) {
    return `https://www.google.com/maps/dir/?api=1&origin=16.245,103.250&destination=${order.latitude},${order.longitude}&travelmode=two-wheeler`;
  }

  phoneUrl(phone: string) {
    return `tel:${phone}`;
  }
}
