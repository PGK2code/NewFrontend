import { AfterViewInit, Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Order } from '../../models/types';
import { ApiService } from '../../services/api';
import { DeliveryPlanningService, RiderRoute } from '../../services/delivery-planning';

declare global {
  interface Window {
    L: any;
  }
}

@Component({
  selector: 'app-routes',
  imports: [CommonModule, RouterLink],
  templateUrl: './routes.html',
})
export class RoutesPage implements AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private activatedRoute = inject(ActivatedRoute);
  private mapHost = viewChild<ElementRef<HTMLDivElement>>('mapHost');
  private map: any;
  private routeLayers: any[] = [];
  private routeGeometryCache = new Map<string, Array<[number, number]>>();
  private mapDrawVersion = 0;
  readonly planner = inject(DeliveryPlanningService);
  loading = signal(false);
  error = signal('');
  notice = signal('');
  mapError = signal('');
  selectedRider = signal(1);
  mapMode = signal<'all' | 'selected'>('all');

  constructor() {
    const rider = Number(this.activatedRoute.snapshot.queryParamMap.get('rider'));
    if (Number.isInteger(rider) && rider > 0) this.selectedRider.set(rider);
    void this.load();
  }

  ngAfterViewInit() {
    this.drawMap();
  }

  ngOnDestroy() {
    this.map?.remove();
  }

  selectedRoute(): RiderRoute | undefined {
    return this.planner.plan().routes.find((route) => route.riderNumber === this.selectedRider());
  }

  visibleMapRoutes(): RiderRoute[] {
    const routes = this.planner.plan().routes;
    return this.mapMode() === 'selected'
      ? routes.filter((route) => route.riderNumber === this.selectedRider())
      : routes;
  }

  selectRoute(riderNumber: number) {
    this.selectedRider.set(riderNumber);
    this.drawMap();
  }

  setMapMode(mode: 'all' | 'selected') {
    this.mapMode.set(mode);
    this.drawMap();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      this.planner.setOrders(await this.api.deliveryOrders());
      await this.planner.loadRoadRoutes();
      const firstRoute = this.planner.plan().routes[0];
      if (firstRoute && !this.planner.plan().routes.some((route) => route.riderNumber === this.selectedRider()))
        this.selectedRider.set(firstRoute.riderNumber);
      setTimeout(() => this.drawMap());
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  async recalculate() {
    this.loading.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      // ใช้ตารางระยะทางถนนจริง แล้วปรับแผนด้วย Local Search ก่อนเลือกแผนที่ดีที่สุด
      const result = await this.planner.recalculateBestPlan(5);
      const firstRoute = this.planner.plan().routes[0];
      if (firstRoute && !this.planner.plan().routes.some((route) => route.riderNumber === this.selectedRider())) {
        this.selectedRider.set(firstRoute.riderNumber);
      }
      if (result && !result.feasible) {
        this.error.set('ยังไม่มีแผนที่ประเมินแล้วว่าส่งทันครบทุกคน ระบบเลือกแผนที่ดีที่สุดจากการค้นหาไว้ให้แล้ว โปรดตรวจสอบเวลาโดยประมาณของแต่ละไรเดอร์');
      } else if (result?.changed) {
        this.notice.set('ปรับแผนด้วยระยะทางถนนจริงแล้ว โดยพิจารณาส่งทันก่อน จากนั้นกำไรและระยะทางรวม');
      } else {
        this.notice.set('ค้นหาและปรับปรุงแผนแล้ว ไม่พบแผนที่ดีกว่าเดิม จึงคงแผนที่ดีที่สุดไว้');
      }
      await this.drawMap();
    } catch (error) {
      this.error.set((error as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  routeFinance(route: RiderRoute) {
    return this.planner.financialSummary(route);
  }

  routeRoadInfo(route: RiderRoute) {
    return this.planner.roadRoutes().find((item) => item.riderNumber === route.riderNumber);
  }

  estimatedMinutes(route: RiderRoute) {
    const road = this.routeRoadInfo(route);
    return road && !road.error ? Math.ceil(Math.max((road.distanceKm / 30) * 60, road.durationMinutes)) : null;
  }

  estimatedArrival(route: RiderRoute) {
    const minutes = this.estimatedMinutes(route);
    if (minutes === null) return null;
    const total = 11 * 60 + 30 + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  allRoutesMeetDeadline() {
    const routes = this.planner.plan().routes;
    return routes.length > 0 && routes.every((route) => {
      const minutes = this.estimatedMinutes(route);
      return minutes !== null && minutes <= 60;
    });
  }

  allRoadRoutesReady() {
    const routes = this.planner.plan().routes;
    const roads = this.planner.roadRoutes();
    return roads.length === routes.length && roads.every((road) => !road.error);
  }

  overallDistanceKm() {
    return this.planner.roadRoutes().reduce((sum, road) => sum + road.distanceKm, 0);
  }

  financeRoutes(): RiderRoute[] {
    const routes = this.planner.plan().routes;
    // In selected-route mode, finance must describe only the selected rider's route.
    return this.mapMode() === 'selected'
      ? routes.filter((route) => route.riderNumber === this.selectedRider())
      : routes;
  }

  overallFinance() {
    const routes = this.financeRoutes();
    const summaries = routes.map((route) => this.planner.financialSummary(route));
    const revenue = summaries.reduce((sum, item) => sum + item.revenue, 0);
    const foodCost = summaries.reduce((sum, item) => sum + item.foodCost, 0);
    const deliveryCost = summaries.some((item) => item.deliveryCost === null)
      ? null
      : summaries.reduce((sum, item) => sum + (item.deliveryCost ?? 0), 0);
    const totalBoxes = routes.reduce((sum, route) => sum + route.totalBoxes, 0);
    const orderCount = routes.reduce((sum, route) => sum + route.orders.length, 0);
    const distanceRoutes = routes.map((route) => this.routeRoadInfo(route));
    const distanceReady = distanceRoutes.length > 0 && distanceRoutes.every((road) => !!road && !road.error);
    const distanceKm = distanceReady ? distanceRoutes.reduce((sum, road) => sum + (road?.distanceKm ?? 0), 0) : null;
    return { revenue, foodCost, deliveryCost, profit: deliveryCost === null ? null : revenue - foodCost - deliveryCost, totalBoxes, orderCount, distanceKm };
  }

  private async drawMap() {
    const host = this.mapHost()?.nativeElement;
    if (!host) return;
    const L = window.L;
    if (!L) {
      this.mapError.set('โหลดแผนที่ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
      return;
    }
    const drawVersion = ++this.mapDrawVersion;
    if (!this.map) {
      const { depotLatitude, depotLongitude } = this.planner.depot;
      this.map = L.map(host).setView([depotLatitude, depotLongitude], 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(this.map);
    }
    for (const layer of this.routeLayers) this.map.removeLayer(layer);
    this.routeLayers = [];
    const settings = this.planner.depot;
    const depot: [number, number] = [settings.depotLatitude, settings.depotLongitude];
    const visiblePoints: Array<[number, number]> = [depot];
    const allRoutes = this.planner.plan().routes;
    const routes = this.mapMode() === 'selected'
      ? allRoutes.filter((route) => route.riderNumber === this.selectedRider())
      : allRoutes;
    const routeFailures: number[] = [];
    const depotMarker = L.marker(depot, {
      icon: L.divIcon({
        className: 'depot-marker-wrap',
        html: '<span class="depot-marker">ครัว</span>',
        iconSize: [42, 30],
        iconAnchor: [21, 15],
      }),
    }).addTo(this.map);
    this.routeLayers.push(depotMarker);

    this.mapError.set(routes.some((route) => route.orders.length) ? 'กำลังคำนวณเส้นทางตามถนน...' : '');
    for (const route of routes) {
      const selected = route.riderNumber === this.selectedRider();
      const stopsByLocation = new Map<
        string,
        { point: [number, number]; firstIndex: number; orders: Array<{ order: Order; index: number }> }
      >();
      route.orders.forEach((order, index) => {
        const point: [number, number] = [Number(order.latitude), Number(order.longitude)];
        visiblePoints.push(point);
        const key = `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
        const stop = stopsByLocation.get(key);
        if (stop) {
          stop.orders.push({ order, index });
        } else {
          stopsByLocation.set(key, { point, firstIndex: index, orders: [{ order, index }] });
        }
      });
      for (const stop of stopsByLocation.values()) {
        const firstOrder = stop.orders[0]?.order;
        if (!firstOrder) continue;
        const marker = L.marker(stop.point, {
          icon: L.divIcon({
            className: 'route-stop-marker',
            html: `<span style="background:${route.color}">${stop.firstIndex + 1}</span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          opacity: selected ? 1 : (this.mapMode() === 'all' ? 0.42 : 0.55),
          zIndexOffset: selected ? 1000 : 0,
        }).addTo(this.map);
        const popup = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = `จุดส่ง ${stop.firstIndex + 1} · ${firstOrder.customer_name}`;
        popup.append(name);
        for (const { order, index } of stop.orders) {
          const detail = document.createElement('div');
          detail.textContent = `ลำดับ ${index + 1} · ออเดอร์ #${order.order_id} · ${order.total_boxes} กล่อง · ${order.total_sales} บาท · ${order.phone_number}`;
          popup.append(detail);
        }
        marker.bindPopup(popup);
        this.routeLayers.push(marker);
      }
    }
    const results = await Promise.all(
      routes.map(async (route) => {
        if (!route.orders.length) return { route, geometry: [] as Array<[number, number]> };
        try {
          const geometry = await this.getRoadGeometry(route, depot);
          return { route, geometry };
        } catch (error) {
          console.error(`Could not calculate road route for rider ${route.riderNumber}.`, error);
          routeFailures.push(route.riderNumber);
          return { route, geometry: [] as Array<[number, number]> };
        }
      }),
    );
    if (drawVersion !== this.mapDrawVersion) return;

    for (const { route, geometry } of results) {
      if (geometry.length < 2) continue;
      const selected = route.riderNumber === this.selectedRider();
      const overviewMode = this.mapMode() === 'all';
      visiblePoints.push(...geometry);
      const line = L.polyline(geometry, {
        // ภาพรวม: แสดงทุกเส้นด้วยสีประจำไรเดอร์และเส้นบาง เพื่อเห็นเส้นทางทั้งหมดพร้อมกัน
        // โหมดไรเดอร์เดี่ยว: เน้นเส้นที่เลือกให้หนาขึ้น
        color: route.color,
        weight: overviewMode ? (selected ? 4 : 2) : (selected ? 5 : 2),
        // ภาพรวม: เส้นอื่นจางแบบแผนที่ตัวอย่าง ส่วนไรเดอร์ที่เลือกยังทึบและเด่นชัด
        opacity: overviewMode ? (selected ? 1 : 0.24) : (selected ? 0.95 : 0.22),
        dashArray: overviewMode || selected ? undefined : '6 7',
      }).addTo(this.map);
      if (selected) line.bringToFront();
      this.routeLayers.push(line);
    }
    if (routeFailures.length) {
      this.mapError.set(
        `คำนวณเส้นทางตามถนนไม่สำเร็จสำหรับไรเดอร์ ${routeFailures.join(', ')} กรุณาลองใหม่ หรือตรวจสอบการเชื่อมต่อบริการ OSRM`,
      );
    } else {
      this.mapError.set('');
    }
    this.map.setView(depot, this.planner.plan().orderCount ? this.map.getZoom() : 13);
    if (visiblePoints.length > 1) this.map.fitBounds(L.latLngBounds(visiblePoints), { padding: [32, 32], maxZoom: 15 });
    setTimeout(() => this.map?.invalidateSize(), 80);
  }

  private async getRoadGeometry(route: RiderRoute, depot: [number, number]): Promise<Array<[number, number]>> {
    // วาดเส้นทางเที่ยวส่งทางเดียว: จากร้านไปยังจุดส่งตามลำดับ ไม่ลากเส้นย้อนกลับมาร้าน
    const waypoints: Array<[number, number]> = [
      depot,
      ...route.orders.map((order) => [Number(order.latitude), Number(order.longitude)] as [number, number]),
    ];
    const coordinates = waypoints.filter(
      (point, index) =>
        index === 0 ||
        point[0].toFixed(6) !== waypoints[index - 1]?.[0].toFixed(6) ||
        point[1].toFixed(6) !== waypoints[index - 1]?.[1].toFixed(6),
    );
    if (coordinates.length < 2) return coordinates;
    const cacheKey = coordinates.map(([latitude, longitude]) => `${latitude.toFixed(6)},${longitude.toFixed(6)}`).join(';');
    const cached = this.routeGeometryCache.get(cacheKey);
    if (cached) return cached;

    const path = coordinates.map(([latitude, longitude]) => `${longitude},${latitude}`).join(';');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`OSRM returned HTTP ${response.status}`);
      const result = (await response.json()) as {
        code?: string;
        message?: string;
        routes?: Array<{ geometry?: { coordinates?: Array<[number, number]> } }>;
      };
      const routeCoordinates = result.routes?.[0]?.geometry?.coordinates;
      if (result.code !== 'Ok' || !routeCoordinates?.length) {
        throw new Error(result.message || `OSRM returned ${result.code || 'no route'}`);
      }
      const geometry = routeCoordinates.map(([longitude, latitude]) => [latitude, longitude] as [number, number]);
      if (this.routeGeometryCache.size >= 100) this.routeGeometryCache.clear();
      this.routeGeometryCache.set(cacheKey, geometry);
      return geometry;
    } finally {
      clearTimeout(timeout);
    }
  }
}
