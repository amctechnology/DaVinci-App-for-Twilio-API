import { Injectable } from '@angular/core';
@Injectable()
export class StorageService {
  public onFocusTaskId: string;

  constructor() {
    this.onFocusTaskId = '';
  }

  public setOnFocus(taskId: string) {
    this.onFocusTaskId = taskId;
    this.storeToLocalStorage();
  }

  private storeToLocalStorage() {
    const scenarioRecord = JSON.stringify({
      onFocusTaskId: this.onFocusTaskId
    });
    localStorage.setItem('scenario', scenarioRecord);
  }

  public syncWithLocalStorage() {
    const scenarioRecord = localStorage.getItem('scenario');
    const browserStorage = JSON.parse(scenarioRecord);
    if (browserStorage) {
      this.onFocusTaskId = browserStorage.onFocusTaskId;
    }
  }
}
