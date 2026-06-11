"use client";

// Email-collection step. The code step lives at its own URL (/sign-in/otp?e=<email>) so a
// reload doesn't drop the email and the back button works the way
// the user expects.

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { FingerprintSimpleIcon } from "@phosphor-icons/react";
import { AsteriskIcon } from "@phosphor-icons/react/dist/ssr";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { sileo } from "sileo";
import Link from "next/link";

function SignInPageBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("e") ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setPending(true);
    setErrorMessage("");
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: trimmed,
      type: "sign-in",
    });
    if (error) {
      const msg = error.message ?? "Could not send code";
      setErrorMessage(msg);
      sileo.error({ title: "Could not send code", description: msg });
      setPending(false);
      return;
    }
    router.push(`/sign-in/otp?e=${encodeURIComponent(trimmed)}`);
  }

  async function handlePasskeySignIn() {
    setPending(true);
    setErrorMessage("");
    const { error } = await authClient.signIn.passkey();
    if (error) {
      const msg = error.message ?? "Passkey sign-in failed";
      setErrorMessage(msg);
      sileo.error({ title: "Passkey sign-in failed", description: msg });
      setPending(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <ThemeToggle />
      <main className="grid grid-cols-1 md:grid-cols-2 min-h-svh">
        <div className="flex min-h-svh w-full flex-col justify-between px-6 py-8 bg-background dark">
          <div>&nbsp;</div>
          <div className="space-y-5 text-lg leading-relaxed text-foreground/85 font-display text-pretty max-w-prose mx-auto">
            <p className="text-3xl leading-10 text-balance">
              <Link href="https://wargame.esq">
                <span className="font-semibold text-red-600 italic">
                  Wargame
                </span>
              </Link>{" "}
              runs simulated negotiations on your business contracts.
            </p>
            <p>
              Two teams of AI agents—one{" "}
              <span className="italic font-medium">friendly</span>, and one{" "}
              <span className="italic font-medium">adversarial</span>—review
              your contract and produce an issues list. The agents negotiate the
              issues point-by-point while you watch their internal reasoning and
              conversation in real time.
            </p>
            <p className="text-pretty">
              When the negotiation wraps up, you receive the negotiated contract
              and a memo summarizing key points. Every argument, concession, and
              decision point is available in the chat transcript.
            </p>
          </div>
          <div className="flex w-full flex-col justify-between lg:px-6 py-8">
            <div className="max-w-prose mx-auto w-full lg:px-12">
              <p className="text-pretty italic text-base font-display mt-12md:mt-24 text-muted-foreground">
                <span className="inline-flex flex-row gap-3">
                  <span className="mt-1 text-foreground/80">
                    <AsteriskIcon size={16} weight="bold" />
                  </span>
                  <span>
                    To use the demo, you&rsquo;ll need an API account from{" "}
                    <a
                      href="https://platform.openai.com/signup"
                      rel="noopener noreferrer"
                      className="text-foreground underline decoration-dotted font-semibold underline-offset-4 transition-colors duration-150 hover:decoration-solid"
                    >
                      OpenAI
                    </a>{" "}
                    or{" "}
                    <a
                      href="https://console.anthropic.com/login"
                      rel="noopener noreferrer"
                      className="text-foreground underline decoration-dotted font-semibold underline-offset-4 transition-colors duration-150 hover:decoration-solid"
                    >
                      Anthropic
                    </a>
                    .
                  </span>
                </span>
              </p>
            </div>
          </div>
        </div>
        <div className="relative flex min-h-svh w-full flex-col justify-between px-6 py-8 bg-foreground/5">
          <div>&nbsp;</div>

          <div className="relative flex flex-col items-center gap-6">
            <form
              onSubmit={handleSendCode}
              className="flex w-full flex-col gap-12 pt-6 max-w-sm mx-auto"
            >
              <div className="flex flex-col gap-4">
                <Input
                  type="email"
                  required
                  autoFocus
                  autoComplete="off"
                  placeholder="Your email address"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMessage) setErrorMessage("");
                  }}
                  aria-label="Email address"
                  aria-invalid={Boolean(errorMessage) || undefined}
                  disabled={pending}
                  className={cn(
                    "h-11",
                    "w-full",
                    "rounded-full",
                    "text-center",
                    "border-ring",
                  )}
                />
                <Button
                  type="submit"
                  disabled={!email.trim() || pending}
                  className="h-11"
                >
                  {pending ? "Sending" : "Send Code"}
                </Button>
              </div>

              <Button
                type="button"
                variant="link"
                onClick={handlePasskeySignIn}
                disabled={pending}
                className="h-11"
              >
                <FingerprintSimpleIcon size={28} />
                Use a Passkey
              </Button>
            </form>
          </div>

          <div>&nbsp;</div>
        </div>
      </main>
    </>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInPageBody />
    </Suspense>
  );
}
