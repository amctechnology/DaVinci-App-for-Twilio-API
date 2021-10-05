import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { HttpClientModule } from '@angular/common/http';
import { UILibraryModule } from '@amc-technology/ui-library';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatSelectModule, MatFormFieldModule } from '@angular/material';
import { FormsModule } from '@angular/forms';
import { LoggerService } from './logger.service';
import { StorageService } from './twilioStorage.service';

@NgModule({
  declarations: [AppComponent],
  imports: [
    BrowserModule,
    HttpClientModule,
    UILibraryModule,
    MatSelectModule,
    MatFormFieldModule,
    BrowserAnimationsModule,
    FormsModule
  ],
  providers: [LoggerService, StorageService],
  bootstrap: [AppComponent]
})
export class AppModule {}
