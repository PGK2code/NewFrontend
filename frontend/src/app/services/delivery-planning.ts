import { Injectable, signal } from '@angular/core';
import { Order } from '../models/types';

export interface RiderRoute {
  riderNumber: number;
  color: string;
  orders: Order[];
  totalBoxes: number;
}

export interface RiderRoadRoute {
  riderNumber: number;
  geometry: Array<[number, number]>;
  distanceKm: number;
  durationMinutes: number;
  error?: string;
}

export interface RiderFinancialSummary {
  revenue: number;
  foodCost: number;
  deliveryCost: number | null;
  profit: number | null;
}

export interface DeliveryPlan {
  routes: RiderRoute[];
  invalidOrders: Order[];
  orderCount: number;
  totalBoxes: number;
}

interface DeliveryDepot {
  depotLatitude: number;
  depotLongitude: number;
}

const ROUTE_COLORS = ['#cf5a4c', '#36886b', '#4779bd', '#a264ae', '#d18a36', '#378c9b', '#bd5a86', '#788d43'];
const MAX_ORDERS_PER_RIDER = 3;
const DEPOT: DeliveryDepot = {
  // พิกัดตั้งต้นโดยประมาณบริเวณมหาวิทยาลัยมหาสารคาม
  // ควรเปลี่ยนเป็นพิกัดร้านจริงก่อนใช้คำนวณค่าส่งจริง
  depotLatitude: 16.245,
  depotLongitude: 103.250,
};

const emptyPlan = (): DeliveryPlan => ({
  routes: [],
  invalidOrders: [],
  orderCount: 0,
  totalBoxes: 0,
});

@Injectable({ providedIn: 'root' })
export class DeliveryPlanningService {
  readonly depot = DEPOT;
  readonly orders = signal<Order[]>([]);
  readonly plan = signal<DeliveryPlan>(emptyPlan());
  readonly roadRoutes = signal<RiderRoadRoute[]>([]);
  private orderSignature = '';
  private calculationNumber = 0;
  private roadRouteCache = new Map<string, Omit<RiderRoadRoute, 'riderNumber'>>();
  private roadRouteRequest = 0;

  setOrders(orders: Order[]) {
    const signature = JSON.stringify(orders);
    this.orders.set(orders);
    if (signature !== this.orderSignature) {
      this.orderSignature = signature;
      this.rebuildPlan();
    }
  }

  async loadRoadRoutes() {
    const request = ++this.roadRouteRequest;
    const depot: [number, number] = [this.depot.depotLatitude, this.depot.depotLongitude];
    const routes = this.plan().routes;
    this.roadRoutes.set([]);
    const results = await Promise.all(
      routes.map(async (route): Promise<RiderRoadRoute> => {
        try {
          const roadRoute = await this.fetchRoadRoute(route, depot);
          return { riderNumber: route.riderNumber, ...roadRoute };
        } catch (error) {
          console.error(`Could not calculate road route for rider ${route.riderNumber}.`, error);
          return {
            riderNumber: route.riderNumber,
            geometry: [],
            distanceKm: 0,
            durationMinutes: 0,
            error: error instanceof Error ? error.message : 'Road route calculation failed',
          };
        }
      }),
    );
    if (request === this.roadRouteRequest) this.roadRoutes.set(results);
  }

  financialSummary(route: RiderRoute): RiderFinancialSummary {
    const revenue = route.orders.reduce((sum, order) => sum + Number(order.total_sales || 0), 0);
    const foodCost = route.totalBoxes * 40;
    const roadRoute = this.roadRoutes().find((entry) => entry.riderNumber === route.riderNumber);
    const deliveryCost = roadRoute && !roadRoute.error ? roadRoute.distanceKm * route.totalBoxes * 2 + 15 : null;
    return {
      revenue,
      foodCost,
      deliveryCost,
      profit: deliveryCost === null ? null : revenue - foodCost - deliveryCost,
    };
  }

  rebuildPlan(seed?: number) {
    const planSeed = seed ?? this.calculationNumber++;
    const deliverableOrders = this.orders().filter((order) => order.status === 'queued' || order.status === 'simulated');
    const invalidOrders = deliverableOrders.filter(
      (order) =>
        !Number.isFinite(Number(order.latitude)) ||
        !Number.isFinite(Number(order.longitude)) ||
        Math.abs(Number(order.latitude)) > 90 ||
        Math.abs(Number(order.longitude)) > 180,
    );
    const orders = deliverableOrders.filter((order) => !invalidOrders.includes(order));
    // แบ่งงานให้แต่ละไรเดอร์ไม่เกิน 3 ออเดอร์ แล้วเรียงลำดับจุดส่งให้ระยะทางเที่ยวส่งสั้นที่สุด
    // คิดระยะทางจากร้านไปตามจุดส่ง ไม่รวมการย้อนกลับมาร้านหลังส่งเสร็จ
    const groupedOrders = this.groupOrders(orders, orders.length, planSeed);
    const routeGroups = groupedOrders.map((group, index) => this.orderStops(group, DEPOT, planSeed + index));
    const routes = routeGroups.map((orderedStops, index) => {
      const totalBoxes = orderedStops.reduce((sum, order) => sum + order.total_boxes, 0);
      return {
        riderNumber: index + 1,
        color: ROUTE_COLORS[index % ROUTE_COLORS.length] ?? '#cf5a4c',
        orders: orderedStops,
        totalBoxes,
      };
    });
    const totalBoxes = routes.reduce((sum, route) => sum + route.totalBoxes, 0);
    this.plan.set({
      routes,
      invalidOrders,
      orderCount: orders.length,
      totalBoxes,
    });
    this.roadRouteRequest++;
    this.roadRoutes.set([]);
  }

  private async fetchRoadRoute(route: RiderRoute, depot: [number, number]): Promise<Omit<RiderRoadRoute, 'riderNumber'>> {
    // ระยะทางและเวลาที่ประเมินใช้เส้นทางเที่ยวส่งทางเดียวเหมือนเส้นที่แสดงบนแผนที่
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
    if (coordinates.length < 2) {
      return { geometry: coordinates, distanceKm: 0, durationMinutes: 0 };
    }

    const cacheKey = coordinates.map(([latitude, longitude]) => `${latitude.toFixed(6)},${longitude.toFixed(6)}`).join(';');
    const cached = this.roadRouteCache.get(cacheKey);
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
        routes?: Array<{
          distance?: number;
          duration?: number;
          geometry?: { coordinates?: Array<[number, number]> };
        }>;
      };
      const roadRoute = result.routes?.[0];
      const routeCoordinates = roadRoute?.geometry?.coordinates;
      if (
        result.code !== 'Ok' ||
        !roadRoute ||
        !routeCoordinates?.length ||
        typeof roadRoute.distance !== 'number' ||
        !Number.isFinite(roadRoute.distance) ||
        typeof roadRoute.duration !== 'number' ||
        !Number.isFinite(roadRoute.duration)
      ) {
        throw new Error(result.message || `OSRM returned ${result.code || 'no route'}`);
      }
      const roadGeometry = routeCoordinates.map(([longitude, latitude]) => [latitude, longitude] as [number, number]);
      const roadResult = {
        geometry: roadGeometry,
        distanceKm: roadRoute.distance / 1000,
        durationMinutes: roadRoute.duration / 60,
      };
      if (this.roadRouteCache.size >= 100) this.roadRouteCache.clear();
      this.roadRouteCache.set(cacheKey, roadResult);
      return roadResult;
    } finally {
      clearTimeout(timeout);
    }
  }

  // จัดกลุ่มจุดส่งใกล้กัน และจำกัดไม่เกิน 3 ออเดอร์ต่อไรเดอร์
  private groupOrders(orders: Order[], maxRiders: number, seed: number) {
    if (!orders.length || !maxRiders) return [];
    const firstOrder = orders[seed % orders.length];
    if (!firstOrder) return [];
    const centers: Array<{ latitude: number; longitude: number }> = [];
    const minimumRiders = Math.ceil(orders.length / MAX_ORDERS_PER_RIDER);
    const seededOrderIds = new Set([firstOrder.order_id]);
    centers.push({
      latitude: Number(firstOrder.latitude),
      longitude: Number(firstOrder.longitude),
    });
    while (centers.length < minimumRiders) {
      const next = orders
        .filter((order) => !seededOrderIds.has(order.order_id))
        .map((order) => ({
          latitude: Number(order.latitude),
          longitude: Number(order.longitude),
          order,
          distance: Math.min(
            ...centers.map((center) =>
              this.distanceBetween(Number(order.latitude), Number(order.longitude), center.latitude, center.longitude),
            ),
          ),
        }))
        .sort((a, b) => b.distance - a.distance || ((a.order.order_id + seed) % orders.length) - ((b.order.order_id + seed) % orders.length))[0];
      if (!next) break;
      centers.push({ latitude: next.latitude, longitude: next.longitude });
      seededOrderIds.add(next.order.order_id);
    }

    let groups: Order[][] = Array.from({ length: centers.length }, () => []);
    for (let iteration = 0; iteration < 5; iteration++) {
      groups = Array.from({ length: centers.length }, () => []);
      const nearestDistance = (order: Order) =>
        Math.min(
          ...centers.map((center) =>
            this.distanceBetween(Number(order.latitude), Number(order.longitude), center.latitude, center.longitude),
          ),
        );
      const sortedOrders = [...orders].sort(
        (a, b) => nearestDistance(b) - nearestDistance(a) || ((a.order_id + seed) % orders.length) - ((b.order_id + seed) % orders.length),
      );
      for (const order of sortedOrders) {
        let chosenIndex = -1;
        let closest = Number.POSITIVE_INFINITY;
        centers.forEach((center, index) => {
          if ((groups[index]?.length ?? 0) >= MAX_ORDERS_PER_RIDER) return;
          const distance = this.distanceBetween(Number(order.latitude), Number(order.longitude), center.latitude, center.longitude);
          if (distance < closest) {
            closest = distance;
            chosenIndex = index;
          }
        });
        if (chosenIndex >= 0) groups[chosenIndex]?.push(order);
      }
      centers.forEach((center, index) => {
        const group = groups[index];
        if (!group?.length) return;
        center.latitude = group.reduce((sum, order) => sum + Number(order.latitude), 0) / group.length;
        center.longitude = group.reduce((sum, order) => sum + Number(order.longitude), 0) / group.length;
      });
    }
    return groups.filter((group) => group.length);
  }

  private orderStops(orders: Order[], settings: DeliveryDepot, seed: number) {
    if (orders.length <= 1) return [...orders];

    // ออเดอร์ต่อไรเดอร์มีไม่เกิน 3 รายการ จึงลองทุกลำดับ (สูงสุด 6 แบบ)
    // แล้วเลือกเส้นทางจากครัว -> ลูกค้าทุกจุด ที่มีระยะเส้นตรงรวมสั้นที่สุด
    const permutations = (items: Order[]): Order[][] => {
      if (items.length <= 1) return [items];
      return items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail]),
      );
    };
    const distance = (sequence: Order[]) => {
      let total = 0;
      let latitude = settings.depotLatitude;
      let longitude = settings.depotLongitude;
      for (const order of sequence) {
        const nextLatitude = Number(order.latitude);
        const nextLongitude = Number(order.longitude);
        total += this.distanceBetween(latitude, longitude, nextLatitude, nextLongitude);
        latitude = nextLatitude;
        longitude = nextLongitude;
      }
      return total;
    };
    const candidates = permutations([...orders]);
    candidates.sort((a, b) => {
      const difference = distance(a) - distance(b);
      if (Math.abs(difference) > 0.000001) return difference;
      // ใช้ seed เฉพาะกรณีระยะเท่ากัน เพื่อให้สามารถเสนอแผนทางเลือกได้โดยไม่สุ่มแผนที่แย่กว่า
      return ((a[0]?.order_id ?? 0) + seed) % orders.length - (((b[0]?.order_id ?? 0) + seed) % orders.length);
    });
    return candidates[0] ?? [...orders];
  }

  /**
   * คำนวณตารางระยะทางถนนจริงเพียงครั้งเดียว แล้วใช้ Local Search
   * ทดลองย้าย/สลับออเดอร์ระหว่างไรเดอร์และลองลำดับจุดส่งทุกแบบ (ไม่เกิน 3 จุด/คน)
   */
  async recalculateBestPlan(attempts = 5) {
    type Matrix = { distances: number[][]; durations: number[][] };
    type Candidate = { plan: DeliveryPlan; feasible: boolean; profit: number; distance: number };

    const basePlan = this.plan();
    const orders = basePlan.routes.flatMap((route) => route.orders);
    if (orders.length <= 1) {
      await this.loadRoadRoutes();
      const road = this.roadRoutes();
      const distance = road.reduce((sum, item) => sum + item.distanceKm, 0);
      const profit = basePlan.routes.reduce((sum, route) => sum + (this.financialSummary(route).profit ?? 0), 0);
      return { feasible: road.every((item) => !item.error && Math.max(item.durationMinutes, item.distanceKm / 30 * 60) <= 60), profit, distanceKm: distance, attempts: 1, changed: false };
    }

    // OSRM Table รับพิกัดเป็น longitude,latitude และคืนเมทริกซ์ระยะทาง/เวลาแบบถนน
    const points: Array<[number, number]> = [
      [DEPOT.depotLongitude, DEPOT.depotLatitude],
      ...orders.map((order) => [Number(order.longitude), Number(order.latitude)] as [number, number]),
    ];
    const coordinates = points.map(([longitude, latitude]) => `${longitude},${latitude}`).join(';');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let matrix: Matrix;
    try {
      const response = await fetch(
        `https://router.project-osrm.org/table/v1/driving/${coordinates}?annotations=distance,duration`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`OSRM Table returned HTTP ${response.status}`);
      const data = await response.json() as { code?: string; message?: string; distances?: Array<Array<number | null>>; durations?: Array<Array<number | null>> };
      if (data.code !== 'Ok' || !data.distances || !data.durations) throw new Error(data.message || 'OSRM ไม่สามารถสร้างตารางระยะทางถนนได้');
      const distances = data.distances.map((row) => row.map((value) => value == null ? Number.POSITIVE_INFINITY : value / 1000));
      const durations = data.durations.map((row) => row.map((value) => value == null ? Number.POSITIVE_INFINITY : value / 60));
      if (distances.length !== points.length || durations.length !== points.length) throw new Error('ตารางระยะทางถนนมีข้อมูลไม่ครบ');
      matrix = { distances, durations };
    } finally {
      clearTimeout(timeout);
    }

    const indexById = new Map(orders.map((order, index) => [order.order_id, index + 1]));
    const routeDistance = (group: Order[]) => {
      let from = 0;
      let distance = 0;
      let minutes = 0;
      for (const order of group) {
        const to = indexById.get(order.order_id);
        if (to === undefined) return { distance: Infinity, minutes: Infinity };
        const legDistance = matrix.distances[from]?.[to] ?? Infinity;
        const legMinutes = matrix.durations[from]?.[to] ?? Infinity;
        if (!Number.isFinite(legDistance) || !Number.isFinite(legMinutes)) return { distance: Infinity, minutes: Infinity };
        distance += legDistance;
        // เผื่อความเร็วจริงตามโจทย์ไม่เกิน 30 กม./ชม. หาก OSRM ประเมินเร็วกว่า
        minutes += Math.max(legMinutes, legDistance / 30 * 60);
        from = to;
      }
      return { distance, minutes };
    };
    const permutations = (items: Order[]): Order[][] => items.length <= 1 ? [items] : items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((tail) => [item, ...tail]),
    );
    const bestOrder = (group: Order[]) => permutations(group).sort((a, b) => {
      const aa = routeDistance(a), bb = routeDistance(b);
      return aa.distance - bb.distance || aa.minutes - bb.minutes;
    })[0] ?? [...group];
    const makePlan = (groups: Order[][]): DeliveryPlan => {
      const routes: RiderRoute[] = groups.filter((group) => group.length).map((rawGroup, index) => {
        const ordered = bestOrder(rawGroup);
        return {
          riderNumber: index + 1,
          color: ROUTE_COLORS[index % ROUTE_COLORS.length] ?? '#cf5a4c',
          orders: ordered,
          totalBoxes: ordered.reduce((sum, order) => sum + Number(order.total_boxes || 0), 0),
        };
      });
      return { routes, invalidOrders: basePlan.invalidOrders, orderCount: orders.length, totalBoxes: routes.reduce((sum, route) => sum + route.totalBoxes, 0) };
    };
    const evaluate = (plan: DeliveryPlan): Candidate => {
      let feasible = true, profit = 0, distance = 0;
      for (const route of plan.routes) {
        const road = routeDistance(route.orders);
        distance += road.distance;
        if (!Number.isFinite(road.distance) || road.minutes > 60) feasible = false;
        const revenue = route.orders.reduce((sum, order) => sum + Number(order.total_sales || 0), 0);
        profit += revenue - route.totalBoxes * 40 - (road.distance * route.totalBoxes * 2 + 15);
      }
      return { plan, feasible, profit, distance };
    };
    const better = (a: Candidate, b: Candidate) => {
      if (a.feasible !== b.feasible) return a.feasible;
      if (Math.abs(a.profit - b.profit) > 0.01) return a.profit > b.profit;
      return a.distance < b.distance - 0.000001;
    };
    const signature = (plan: DeliveryPlan) => plan.routes.map((route) => `${route.riderNumber}:${route.orders.map((order) => order.order_id).join(',')}`).join('|');

    let best = evaluate(basePlan);
    const count = Math.max(1, Math.min(8, Math.floor(attempts)));
    const maxRiders = Math.ceil(orders.length / MAX_ORDERS_PER_RIDER);

    // สร้างจุดเริ่มต้นหลายแบบ จากนั้นปรับด้วยการย้าย/สลับออเดอร์ (Local Search)
    for (let seed = 0; seed < count; seed++) {
      this.rebuildPlan(seed);
      let groups = this.plan().routes.map((route) => [...route.orders]);
      // ถ้ามีช่องว่างจากการแบ่งกลุ่ม ให้เติมออเดอร์ที่ยังไม่ถูกจัดส่ง
      const assigned = new Set(groups.flat().map((order) => order.order_id));
      const missing = orders.filter((order) => !assigned.has(order.order_id));
      for (const order of missing) {
        let group = groups.find((item) => item.length < MAX_ORDERS_PER_RIDER);
        if (!group && groups.length < maxRiders) { group = []; groups.push(group); }
        group?.push(order);
      }
      groups = groups.filter((group) => group.length).map((group) => bestOrder(group));
      let current = evaluate(makePlan(groups));
      let improved = true;
      let iteration = 0;
      while (improved && iteration++ < 250) {
        improved = false;
        outer: for (let from = 0; from < groups.length; from++) {
          for (let i = 0; i < (groups[from]?.length ?? 0); i++) {
            const moving = groups[from]?.[i];
            if (!moving) continue;
            // ทดลองย้ายออเดอร์ไปกลุ่มอื่น โดยไม่เกิน 3 ออเดอร์ต่อไรเดอร์
            for (let to = 0; to < groups.length; to++) {
              if (from === to || (groups[to]?.length ?? 0) >= MAX_ORDERS_PER_RIDER) continue;
              const nextGroups = groups.map((group) => [...group]);
              nextGroups[from]?.splice(i, 1);
              nextGroups[to]?.push(moving);
              const normalized = nextGroups.filter((group) => group.length).map((group) => bestOrder(group));
              const candidate = evaluate(makePlan(normalized));
              if (better(candidate, current)) { groups = normalized; current = candidate; improved = true; break outer; }
            }
            // ทดลองสลับออเดอร์ระหว่างไรเดอร์
            for (let to = from + 1; to < groups.length; to++) {
              for (let j = 0; j < (groups[to]?.length ?? 0); j++) {
                const nextGroups = groups.map((group) => [...group]);
                const a = nextGroups[from]?.[i], b = nextGroups[to]?.[j];
                if (!a || !b) continue;
                nextGroups[from]![i] = b;
                nextGroups[to]![j] = a;
                const normalized = nextGroups.map((group) => bestOrder(group));
                const candidate = evaluate(makePlan(normalized));
                if (better(candidate, current)) { groups = normalized; current = candidate; improved = true; break outer; }
              }
            }
          }
        }
      }
      if (better(current, best)) best = current;
    }

    this.plan.set(best.plan);
    this.roadRouteRequest++;
    this.roadRoutes.set([]);
    await this.loadRoadRoutes();
    const finalRoads = this.roadRoutes();
    const finalFeasible = finalRoads.length === best.plan.routes.length && finalRoads.every((road) => !road.error && Math.max(road.durationMinutes, road.distanceKm / 30 * 60) <= 60);
    const finalProfit = finalRoads.some((road) => road.error) ? null : best.plan.routes.reduce((sum, route) => sum + (this.financialSummary(route).profit ?? 0), 0);
    const finalDistance = finalRoads.reduce((sum, road) => sum + road.distanceKm, 0);
    return {
      feasible: finalFeasible,
      profit: finalProfit,
      distanceKm: finalDistance,
      attempts: count,
      changed: signature(best.plan) !== signature(basePlan),
    };
  }

  private distanceBetween(lat1: number, lon1: number, lat2: number, lon2: number) {
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    const dLat = radians(lat2 - lat1);
    const dLon = radians(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }
}
