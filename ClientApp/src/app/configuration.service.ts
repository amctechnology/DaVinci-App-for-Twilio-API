import { Injectable, Inject } from '@angular/core';
import { IConfiguration } from './model/IConfiguration';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class ConfigurationService {
  private readonly configUrlPath: string = 'ClientConfiguration';
  private configData: IConfiguration;

  constructor(
    private http: HttpClient,
    @Inject('BASE_URL') private originUrl: string
  ) {}

  async loadConfigurationData(): Promise<IConfiguration> {
    this.configData = await this.http
      .get<IConfiguration>(`${this.originUrl}${this.configUrlPath}`)
      .toPromise();
    return this.configData;
  }
}
