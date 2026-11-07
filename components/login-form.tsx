"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, LogIn, UserPlus, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(50),
  password: z.string().min(8, "Password must be at least 8 characters").max(100),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Login fields
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register fields
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        authMode === "login"
          ? { username: loginUsername, password: loginPassword }
          : { username: regUsername, password: regPassword, confirmPassword: regConfirmPassword };

      const schema = authMode === "login" ? loginSchema : registerSchema;
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        setError(parsed.error.issues[0].message);
        setIsLoading(false);
        return;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || (authMode === "login" ? "Login failed" : "Registration failed"));
        return;
      }

      toast.success(authMode === "login" ? "Logged in successfully" : "Account created successfully");
      if (onSuccess) {
        onSuccess();
      } else {
        const destination = searchParams.get("redirect") || "/";
        router.push(destination);
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl shadow-primary/5">
      <CardHeader className="text-center space-y-2">
        <div className="mx-auto w-12 h-12 rounded-xl bg-linear-to-br from-primary to-primary/60 flex items-center justify-center mb-2">
          <span className="text-2xl font-bold text-primary-foreground">D</span>
        </div>
        <CardTitle className="text-2xl font-bold tracking-tight">
          {authMode === "login" ? "Welcome back" : "Create your account"}
        </CardTitle>
        <CardDescription>
          {authMode === "login"
            ? "Sign in to access your TorBox files"
            : "Create a DoMa account to manage your TorBox connections"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Tabs
          value={authMode}
          onValueChange={(v) => {
            setAuthMode(v as "login" | "register");
            setError(null);
          }}
        >
          <TabsList>
            <TabsTrigger value="login">Log In</TabsTrigger>
            <TabsTrigger value="register">Sign Up</TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit}>
            <TabsContent value="login">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="login-username" className="text-sm font-medium">
                    Username
                  </label>
                  <Input
                    id="login-username"
                    type="text"
                    placeholder="yourusername"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    disabled={isLoading}
                    autoComplete="username"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="login-password" className="text-sm font-medium">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="**********"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      disabled={isLoading}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 cursor-pointer -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-hidden"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="register">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="reg-username" className="text-sm font-medium">
                    Username
                  </label>
                  <Input
                    id="reg-username"
                    type="text"
                    placeholder="yourusername"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    disabled={isLoading}
                    autoComplete="username"
                    required
                    minLength={3}
                    maxLength={50}
                  />
                  <p className="text-xs text-muted-foreground">
                    At least 3 characters
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="reg-password" className="text-sm font-medium">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="**********"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      disabled={isLoading}
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={100}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 cursor-pointer -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-hidden"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    At least 8 characters
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="reg-confirm-password" className="text-sm font-medium">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Input
                      id="reg-confirm-password"
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="**********"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      disabled={isLoading}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute cursor-pointer right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-hidden"
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {error && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full mt-6"
              disabled={isLoading}
              id="login-submit"
            >
              {isLoading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : authMode === "login" ? (
                <LogIn size={18} />
              ) : (
                <UserPlus size={18} />
              )}
              {isLoading
                ? authMode === "login"
                  ? "Signing in..."
                  : "Creating account..."
                : authMode === "login"
                  ? "Sign In"
                  : "Create Account"}
            </Button>
          </form>
        </Tabs>
      </CardContent>
    </Card>
  );
}