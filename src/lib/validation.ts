import { z } from "zod";

export const usernameSchema = z
  .string()
  .min(3, "Username must be at least 3 characters")
  .max(20, "Username must be less than 20 characters")
  .regex(
    /^[a-zA-Z0-9]+$/,
    "Username can only contain letters and numbers (no spaces, symbols, or underscores)",
  );
