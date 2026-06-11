import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Better-Auth's catch-all API. The browser hits these for OTP
// send/verify, passkey register/authenticate, sign-out, etc.
export const { GET, POST } = toNextJsHandler(auth.handler);
