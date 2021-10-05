import { Component, OnInit, AfterViewChecked } from '@angular/core';
import { setAppHeight } from '@amc-technology/davinci-api';
import { Observable } from 'rxjs';
import { IScenario } from '@amc-technology/ui-library';
import { ScenarioService } from './scenario.service';
import { TwilioService } from './twilio.service';
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, AfterViewChecked {
  title = 'DavinciContactCenter';
  scenarios: Observable<IScenario>[] = [];
  height: number;
  isChrome: any;
  chromeUserHasntEnabledAudio: any;

  constructor(
    private scenarioService: ScenarioService,
    private twilioService: TwilioService
  ) {
    this.isChrome =
      /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
    this.twilioService.isChrome =
      /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor);
    this.chromeUserHasntEnabledAudio = false;
  }

  ngOnInit(): void {
    this.scenarioService.scenarios$.subscribe((scenarioObs) => {
      this.scenarios.push(scenarioObs);
      scenarioObs.subscribe(
        () => {},
        () => {},
        () => {
          const index = this.scenarios.indexOf(
            scenarioObs as Observable<IScenario>
          );
          this.scenarios.splice(index, 1);
        }
      );
    });
  }

  ngAfterViewChecked() {
    if (this.height !== document.body.scrollHeight + 1) {
      this.height = document.body.scrollHeight + 1;
      setAppHeight(this.height);
    }
  }

  userSelectedYesSoundNotifications() {
    this.chromeUserHasntEnabledAudio = true;
    this.twilioService.userEnabledSound = true;
    setAppHeight(10);
  }

  newMessage(message: string, scenario: IScenario) {
    this.twilioService.sendMessage(
      scenario.interactions[0].interactionId,
      message
    );
  }
}
