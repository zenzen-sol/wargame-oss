"use client";

// Code-entry step. The email lives in the URL (`?e=<email>`) so a
// reload, share, or back-nav doesn't drop it. Mirrors the maana-data
// /otp pattern:
//   - real OTP slot input (input-otp) with autoFocus + numeric-only
//   - auto-submit when the user enters the last digit
//   - on error, reset the slots so they can try again without
//     manually clearing
//   - toast for failures + an inline status line under the slots
//   - "Start over" button bottom-centered, carries email back so the
//     email field stays prefilled

import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { CaretLeftIcon } from "@phosphor-icons/react";
import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { sileo } from "sileo";

const OTP_LENGTH = 6;

function OtpFormBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("e") ?? "";

  const [token, setToken] = useState("");
  const [pending, setPending] = useState(false);
  // Bumped after every error to clear the slots without forcing the
  // user to delete characters by hand.
  const [resetKey, setResetKey] = useState(0);

  // Tracks which token we've already submitted. Using a ref (not
  // `pending` state in the effect deps) is load-bearing: if `pending`
  // were a dep, `setPending(true)` inside the IIFE would re-render,
  // re-run the effect, and the cleanup would set `cancelled = true`
  // BEFORE the auth call resolves. Then the post-await `if (cancelled)`
  // would silently bail out of `router.push("/")` and the UI would
  // hang on "Signing in" forever. The ref guards against double-fire
  // without changing what the effect depends on.
  const submittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!email) router.replace("/sign-in");
  }, [email, router]);

  // Auto-submit once the user enters the final digit. The submittedRef
  // guard handles StrictMode double-mount + accidental re-entry; the
  // post-await checks intentionally do NOT short-circuit on
  // "cancelled" because there is no cancellation that should suppress
  // the navigation (see comment on submittedRef above).
  useEffect(() => {
    if (token.length !== OTP_LENGTH || !email) return;
    if (submittedRef.current === token) return;
    submittedRef.current = token;

    (async () => {
      setPending(true);
      try {
        const { error } = await authClient.signIn.emailOtp({
          email,
          otp: token,
        });
        if (error) {
          sileo.error({
            title: "Sign-in failed",
            description: error.message ?? "Invalid or expired code.",
          });
          setToken("");
          setResetKey((k) => k + 1);
          setPending(false);
          // Reset so the next attempt with the same digits (unlikely
          // but possible) actually re-fires.
          submittedRef.current = null;
          return;
        }
        router.push("/");
        router.refresh();
      } catch (err) {
        // The auth-client throws (rather than returning { error }) on
        // some failure modes — e.g. 429 from the server-side rate
        // limiter. Without this catch the rejection is unhandled and
        // `pending` stays true forever.
        sileo.error({
          title: "Sign-in failed",
          description:
            err instanceof Error
              ? err.message
              : "Something went wrong. Try again in a moment.",
        });
        setToken("");
        setResetKey((k) => k + 1);
        setPending(false);
        submittedRef.current = null;
      }
    })();
  }, [token, email, router]);

  if (!email) return null;

  return (
    <main className="relative">
      {/* Backdrop image: full-bleed behind the OTP card. The
          centered content stays on top via its own stacking
          context (z-index ≥ 0 on the relative wrapper). */}
      {/* <Image
        src="/images/otp.png"
        alt=""
        fill
        priority
        sizes="100vw"
        aria-hidden
        className="-z-10 object-cover"
      /> */}
      <div className="relative mx-auto flex min-h-svh w-full max-w-xl flex-col justify-between px-6 py-8 text-center">
        <div>&nbsp;</div>

        <div className="flex flex-col items-center gap-10">
          <div className="flex flex-col items-center gap-2">
            <h1 className="font-display font-semibold text-lg italic">
              Check your email.
            </h1>
          </div>

          <OTPInput
            key={resetKey}
            autoFocus
            containerClassName="flex items-center gap-2 has-disabled:opacity-50 w-full"
            disabled={pending}
            maxLength={OTP_LENGTH}
            name="token"
            onChange={setToken}
            pattern={REGEXP_ONLY_DIGITS}
            value={token}
            render={({ slots }) => (
              <div className="flex w-full flex-row flex-wrap justify-center gap-2">
                {slots.map((slot, idx) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: OTP slots have fixed position; idx is the stable identity.
                    key={idx}
                    className={cn(
                      "size-12 flex items-center justify-center rounded-lg",
                      "border-2",
                      "text-lg font-medium tabular-nums",
                      slot.isActive &&
                        "z-10 border-border ring-2 ring-foreground/20",
                    )}
                  >
                    {slot.char !== null && <div>{slot.char}</div>}
                  </div>
                ))}
              </div>
            )}
          />

          <div aria-live="polite" className="min-h-5">
            {pending ? (
              <Shimmer
                as="span"
                base="var(--color-foreground)"
                highlight="var(--color-background)"
              >
                Signing in
              </Shimmer>
            ) : (
              <span className="text-foreground/60">
                One-time code sent to {email}
              </span>
            )}
          </div>
        </div>

        <div className="flex w-full justify-center">
          <Button
            variant="ghost"
            onClick={() =>
              router.push(`/sign-in?e=${encodeURIComponent(email)}`)
            }
            className="gap-2"
          >
            <CaretLeftIcon size={18} weight="bold" />
            <span className="text-xs uppercase tracking-wider">Start over</span>
          </Button>
        </div>
      </div>
    </main>
  );
}

export default function OtpPage() {
  return (
    <Suspense>
      <OtpFormBody />
    </Suspense>
  );
}
