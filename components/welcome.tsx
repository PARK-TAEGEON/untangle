"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { SAMPLE_PERSONAS } from "../lib/sample-mode";
import { useWorkspace } from "./workspace-provider";

function WelcomeThread() {
  return <svg className="thread-drawing welcome-drawing" viewBox="0 0 1000 110" fill="none" aria-hidden="true">
    <path className="welcome-knot" pathLength="1" vectorEffect="non-scaling-stroke" d="M14 60c18-52 52 40 30-14s46-50 40 6 34 36 30-4c-4-34 28-30 32 2 3 26 30 14 22-10s30-24 34 4c3 20 18 16 28 16" />
    <path className="welcome-thread-tail" pathLength="1" vectorEffect="non-scaling-stroke" d="M230 60H986" />
  </svg>;
}

export function Welcome() {
  const { ready, error, mode, workspace, startSample, exitSample } = useWorkspace();
  const router = useRouter();
  const [showSamples, setShowSamples] = useState(false);
  const samplesId = useId();
  return <main className="welcome-page">
    <div className="welcome-content">
      <WelcomeThread />
      <h1 lang="en">untangle</h1>
      <p className="welcome-tagline" lang="en">Every knot gives way, one thread at a time.</p>
      <p className="welcome-description">흩어진 일을 풀어, 오늘의 한 걸음으로.</p>
      <div className="welcome-actions">
        <button type="button" className="button button-primary" disabled={!ready} aria-expanded={showSamples} aria-controls={samplesId} onClick={() => setShowSamples((current) => !current)}>샘플로 둘러보기</button>
        <Link href="/start" className="button button-secondary" aria-disabled={!ready} tabIndex={ready ? undefined : -1} onClick={(event) => {
          if (!ready || (mode === "sample" && !exitSample())) event.preventDefault();
        }}>내 기록으로 시작하기</Link>
      </div>
      {error && <p className="welcome-error" role="alert">{error}</p>}
      <section id={samplesId} className="welcome-samples" aria-label="샘플로 둘러보기" hidden={!showSamples}>
        {showSamples && <><h2>어떤 하루를 둘러볼까요?</h2><p className="muted">가상으로 만든 두 사람의 기록이에요. 준비된 카드로 바로 둘러볼 수 있어요.</p>
          <div className="sample-personas">{SAMPLE_PERSONAS.map((persona) => <button type="button" className="sample-persona" key={persona.id} disabled={!ready} aria-pressed={mode === "sample" && workspace?.sample?.persona === persona.id} onClick={() => {
            if (startSample(persona.id)) router.push("/");
          }}><strong>{persona.title}</strong><span>{persona.description}</span></button>)}</div>
        </>}
      </section>
    </div>
  </main>;
}
