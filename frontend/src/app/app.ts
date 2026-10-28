import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from './services/api';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  api = inject(ApiService);
  private router = inject(Router);
  isRiderPage = signal(this.isRiderUrl(this.router.url));

  constructor() {
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.isRiderPage.set(this.isRiderUrl(event.urlAfterRedirects)));
  }

  private isRiderUrl(url: string): boolean {
    return url.split(/[?#]/, 1)[0].replace(/\/$/, '') === '/rider';
  }
}
