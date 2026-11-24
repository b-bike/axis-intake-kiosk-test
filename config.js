/* ============================================================
   Axis PT Intake Kiosk — TEST CONFIGURATION (single form)
   This is a TEST COPY of the live kiosk. It has one form, a "requireSubmit" mode
   (no Done button; the form's thank-you link confirms submission), and a red TEST banner.
   REMINDER: this repo is PUBLIC. Never put patient data,
   passwords, or private links that grant edit access in here.
   ============================================================ */
window.KIOSK_CONFIG = {
  testMode: true,            // shows the red TEST banner
  requireSubmit: true,       // patient must submit (then tap the thank-you link) or skip. No Done button.

  clinicName: "AXIS Physical Therapy",
  logo: "https://axisptutah.com/images/logo-nav.png",
  frontDeskLabel: "front desk",

  /* Same staff PIN as the live kiosk (SHA-256 hash). */
  staffPinSha256: "a1fb4e703a9ef1fa4936801721ff285a97ac85330856674412e054892afe6972",

  /* ONE test form: a COPY of the LEFS Microsoft Form (Forms > the LEFS card > ... > Duplicate).
     Use a copy so test submissions don't create real PDFs or emails from the live flow.
     TO FINISH SETUP, fill in the three TODO values from the copy:
       url        Collect responses > Copy link   (must end up on forms.cloud.microsoft)
       nameParam  from "Get pre-filled link": the part before "=" for the patient-name question
       dobParam   same, for the date-of-birth question
     The copy's thank-you message must contain this link:
       Tap here to continue: https://b-bike.github.io/axis-intake-kiosk-test/done.html?f=lefs
     The "f=lefs" part must match the form id below. */
  namePlaceholder: "PATIENTNAME",
  forms: [
    { id: "lefs", title: "TEST: Lower Extremity Functional Scale (LEFS copy)", desc: "Test copy, not a real patient form",
      minutes: 4,
      url: "https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=K_j3YfnYNkuP-lOlrjcwegvi4db-qHVOrSDQtYnWAY5UN1BIMVRQWDJXVFlKUjZRWEtSSVRYMUNKMi4u&embed=true",   // embed link of the TEST copy
      nameParam: "",  // TODO: question ID of the name question in the copy
      dobParam: "",   // TODO: question ID of the date-of-birth question in the copy
      checkedByDefault: true }
  ],

  /* WebPT is turned off in the test copy. */
  webpt: { enabled: false, position: "first", mode: "frame", allowedHosts: ["webpt.com"] },

  timeouts: {
    patientQuestionSec: 200,
    patientLockSec: 320,
    formQuestionSec: 200,
    staffResetSec: 120,
    lockAutoResetMin: 30,
    doneAutoResetSec: 90,
    iframeLoadSec: 20
  }
};
