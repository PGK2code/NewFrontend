import { AfterViewInit, Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Customer } from '../../models/types';
import { ApiService } from '../../services/api';

declare global {
  interface Window {
    L: any;
  }
}
type CustomerDraft = {
  first_name: string;
  last_name: string;
  phone_number: string;
  address: string;
  latitude: number;
  longitude: number;
};
const emptyDraft = (): CustomerDraft => ({
  first_name: '',
  last_name: '',
  phone_number: '',
  address: '',
  latitude: 16.2458,
  longitude: 103.2508,
});

@Component({
  selector: 'app-customers',
  imports: [CommonModule, FormsModule],
  templateUrl: './customers.html',
})
export class CustomersPage implements AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private mapHost = viewChild<ElementRef<HTMLDivElement>>('mapHost');
  private map: any;
  private marker: any;
  customers = signal<Customer[]>([]);
  query = '';
  editing = signal(false);
  editingId = signal<number | null>(null);
  saving = signal(false);
  notice = signal('');
  isError = signal(false);
  draft = emptyDraft();

  constructor() {
    void this.load();
  }

  ngAfterViewInit() {
    this.initMap();
  }

  ngOnDestroy() {
    this.map?.remove();
  }

  filtered() {
    const q = this.query.trim().toLocaleLowerCase();
    return this.customers().filter(
      (c) =>
        !q || `${c.first_name} ${c.last_name} ${c.phone_number} ${c.address ?? ''}`.toLocaleLowerCase().includes(q),
    );
  }

  mapLink(c: Customer) {
    return `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=17/${c.latitude}/${c.longitude}`;
  }

  async load() {
    try {
      this.customers.set(await this.api.customers());
    } catch (e) {
      this.showError((e as Error).message);
    }
  }

  openCreate() {
    this.editingId.set(null);
    this.draft = emptyDraft();
    this.notice.set('');
    this.editing.set(true);
    setTimeout(() => this.initMap(), 0);
  }

  openEdit(c: Customer) {
    this.editingId.set(c.customer_id);
    this.draft = {
      first_name: c.first_name,
      last_name: c.last_name,
      phone_number: c.phone_number,
      address: c.address ?? '',
      latitude: Number(c.latitude),
      longitude: Number(c.longitude),
    };
    this.notice.set('');
    this.editing.set(true);
    setTimeout(() => this.initMap(true), 0);
  }

  close() {
    this.editing.set(false);
    this.map?.remove();
    this.map = undefined;
    this.marker = undefined;
  }

  initMap(preserve = false) {
    const host = this.mapHost()?.nativeElement;
    if (!this.editing() || !host) return;
    const L = window.L;
    if (!L) return;
    this.map?.remove();
    const center: [number, number] = preserve ? [this.draft.latitude, this.draft.longitude] : [16.2458, 103.2508];
    this.map = L.map(host).setView(center, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(this.map);
    this.marker = L.marker([this.draft.latitude, this.draft.longitude], {
      draggable: true,
    }).addTo(this.map);
    this.marker.on('dragend', () => this.setCoordinates(this.marker.getLatLng().lat, this.marker.getLatLng().lng));
    this.map.on('click', (e: any) => {
      this.marker.setLatLng(e.latlng);
      this.setCoordinates(e.latlng.lat, e.latlng.lng);
    });
    setTimeout(() => this.map?.invalidateSize(), 80);
  }

  setCoordinates(lat: number, lng: number) {
    this.draft = {
      ...this.draft,
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
    };
  }

  syncMarker() {
    if (!this.map || !this.marker || !Number.isFinite(this.draft.latitude) || !Number.isFinite(this.draft.longitude))
      return;
    this.marker.setLatLng([this.draft.latitude, this.draft.longitude]);
    this.map.panTo([this.draft.latitude, this.draft.longitude]);
  }

  locate() {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        this.setCoordinates(p.coords.latitude, p.coords.longitude);
        this.map?.setView([p.coords.latitude, p.coords.longitude], 16);
        this.marker?.setLatLng([p.coords.latitude, p.coords.longitude]);
      },
      () => this.showError('ไม่สามารถอ่านตำแหน่งได้ กรุณาอนุญาตตำแหน่งหรือปักหมุดบนแผนที่'),
    );
  }

  async save() {
    this.saving.set(true);
    try {
      await this.api.saveCustomer(
        { ...this.draft, address: this.draft.address.trim() || null },
        this.editingId() ?? undefined,
      );
      this.close();
      await this.load();
      this.showSuccess('บันทึกข้อมูลลูกค้าเรียบร้อย');
    } catch (e) {
      this.showError((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  async remove(c: Customer) {
    if (!confirm(`ลบข้อมูล ${c.first_name} ${c.last_name}?`)) return;
    try {
      await this.api.deleteCustomer(c.customer_id);
      await this.load();
      this.showSuccess('ลบข้อมูลลูกค้าเรียบร้อย');
    } catch (e) {
      this.showError((e as Error).message);
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
