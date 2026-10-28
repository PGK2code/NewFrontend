export interface Customer {
  customer_id: number;
  first_name: string;
  last_name: string;
  address: string | null;
  phone_number: string;
  latitude: number;
  longitude: number;
}
export interface Food {
  food_id: number;
  name: string;
  price: number;
}
export interface OrderItem {
  order_detail_id: number;
  order_id: number;
  food_id: number;
  food_name: string;
  quantity: number;
  unit_price: number;
}
export interface Order {
  order_id: number;
  customer_id: number;
  work_id?: number | null;
  rider_id?: number | null;
  rider_name?: string | null;
  route_color?: string | null;
  customer_name: string;
  phone_number: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  order_date: string;
  total_boxes: number;
  delivery_queue: number | null;
  status: string;
  total_sales: number;
  items: OrderItem[];
}

export interface WorkRecord {
  work_id: number;
  rider_id: number;
  rider_name: string | null;
  route_color: string;
  total_distance: number;
  total_boxes: number;
  profit: number;
  total_sales: number;
  created_at: string;
  delivery_cost: number;
  orders: Order[];
}
