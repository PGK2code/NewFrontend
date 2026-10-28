import { Routes } from '@angular/router';
import { DashboardPage } from './pages/dashboard/dashboard';
import { CustomersPage } from './pages/customers/customers';
import { OrdersPage } from './pages/orders/orders';
import { RoutesPage } from './pages/routes/routes';
import { Sheets } from './pages/sheets/sheets';
import { RiderPage } from './pages/rider/rider';

export const routes: Routes = [
  { path: '', component: DashboardPage, title: 'ภาพรวม | ครัวเก้าแว่น' },
  {
    path: 'customers',
    component: CustomersPage,
    title: 'ลูกค้า | ครัวเก้าแว่น',
  },
  { path: 'orders', component: OrdersPage, title: 'ออเดอร์ | ครัวเก้าแว่น' },
  { path: 'sheets', component: Sheets, title: 'ตารางงาน | ครัวเก้าแว่น' },
  { path: 'rider', component: RiderPage, title: 'งานจัดส่ง | ครัวเก้าแว่น' },
  { path: 'routes', component: RoutesPage, title: 'เส้นทางจัดส่ง | ครัวเก้าแว่น' },
  { path: '**', redirectTo: '' },
];
