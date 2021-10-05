import { TestBed } from '@angular/core/testing';

import { AmcService } from './amc.service';

describe('AmcService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('should be created', () => {
    const service: AmcService = TestBed.get(AmcService);
    expect(service).toBeTruthy();
  });
});
