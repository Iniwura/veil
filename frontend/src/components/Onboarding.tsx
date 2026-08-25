import { useEffect, useState } from "react";

const STORAGE_KEY = "unveil.guide.completed.v1";
const STEPS = [
  ["SAVE PRIVATELY", "Wrap TEST token into confidential principal and submit an encrypted deposit."],
  ["YOUR POSITION BECOMES AN ENCRYPTED DRAW WEIGHT", "The pool uses your private balance without revealing it."],
  ["DRAWS RUN ON A FIXED PUBLIC SCHEDULE", "Anyone can verify and advance the lifecycle when contract state allows."],
  [
    "UNVEIL YOUR PRIVATE STATS WITH YOUR WALLET",
    "A wallet signature decrypts only values your account is authorized to see.",
  ],
  [
    "CONFIDENTIAL PRIZES ARRIVE AUTOMATICALLY",
    "Winners receive TEST strategy shares without an authorize or claim transaction.",
  ],
] as const;

function GuideVisual({ step }: { step: number }) {
  return (
    <div className={`guide-visual guide-visual--${step}`} aria-hidden="true">
      {step === 0 && (
        <>
          <span>100 TEST</span>
          <i>→</i>
          <strong>████████</strong>
        </>
      )}
      {step === 1 && (
        <>
          <strong>████████</strong>
          <div className="guide-field">
            <i />
            <i />
            <i />
            <i />
          </div>
        </>
      )}
      {step === 2 && (
        <div className="guide-timeline">
          <i>OPEN</i>
          <i>CLOSE</i>
          <i>NEXT</i>
        </div>
      )}
      {step === 3 && (
        <>
          <span>WALLET SIGNATURE</span>
          <i>→</i>
          <strong>UNVEIL</strong>
        </>
      )}
      {step === 4 && (
        <>
          <span>DELIVERED</span>
          <i>↓</i>
          <strong>••••••</strong>
        </>
      )}
    </div>
  );
}

function onboardingCompleted() {
  return window.localStorage.getItem(STORAGE_KEY) === "true";
}

export function Onboarding({ replayToken }: { replayToken: number }) {
  const [open, setOpen] = useState(() => !onboardingCompleted());
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (replayToken > 0) {
      setOpen(true);
      setStarted(false);
      setStep(0);
    }
  }, [replayToken]);

  function complete() {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  }

  if (!open) return null;
  return (
    <div className="onboarding-backdrop" role="presentation">
      <section className="onboarding" role="dialog" aria-modal="true" aria-labelledby="guide-title">
        <div className="onboarding-index">{started ? `${step + 1} / ${STEPS.length}` : "FIRST VISIT"}</div>
        {!started ? (
          <>
            <span className="eyebrow">UNVEIL IN TWO MINUTES</span>
            <h2 id="guide-title">
              PRIVATE BY DEFAULT.
              <br />
              CLEAR WHEN YOU CHOOSE.
            </h2>
            <p>Learn the five ideas that make UNVEIL different. No transaction is required.</p>
            <div className="onboarding-actions">
              <button className="button-primary" onClick={() => setStarted(true)}>
                START 2-MIN GUIDE
              </button>
              <button className="button-quiet" onClick={complete}>
                SKIP
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="eyebrow">STEP {step + 1}</span>
            <h2 id="guide-title">{STEPS[step][0]}</h2>
            <p>{STEPS[step][1]}</p>
            <GuideVisual step={step} />
            <div className="guide-progress" aria-hidden="true">
              {STEPS.map((_, index) => (
                <i className={index <= step ? "active" : ""} key={index} />
              ))}
            </div>
            <div className="onboarding-actions">
              <button
                className="button-primary"
                onClick={() => (step === STEPS.length - 1 ? complete() : setStep(step + 1))}
              >
                {step === STEPS.length - 1 ? "DONE" : "NEXT"}
              </button>
              <button className="button-quiet" onClick={complete}>
                SKIP
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
