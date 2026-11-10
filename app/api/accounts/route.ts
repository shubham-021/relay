import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import {
  getAccountByEmail,
  getAccountById,
  createAccount,
  getAccountsByUserId,
  deleteAccount,
  getDb,
} from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { authenticateTorBox } from "@/lib/torbox";
import { syncAccount } from "@/lib/sync";

const db = getDb();

const addAccountSchema = z.object({
  torbox_email: z.email("A valid TorBox email is required"),
  torbox_password: z.string().min(1, "TorBox password is required"),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const accounts = getAccountsByUserId(session.userId);
    return NextResponse.json({ accounts });
  } catch (error) {
    console.error("Get accounts error:", error);
    return NextResponse.json({ error: "Failed to get accounts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = addAccountSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { torbox_email, torbox_password } = parsed.data;

    // Check if account already exists for this user
    const existing = getAccountByEmail(session.userId, torbox_email);
    if (existing) {
      return NextResponse.json(
        { success: false, error: "This TorBox account is already added" },
        { status: 409 }
      );
    }

    // Validate credentials by authenticating with TorBox
    let authResult;
    try {
      authResult = await authenticateTorBox(torbox_email, torbox_password);
    } catch (e: any) {
      const message = e.message || "Invalid TorBox credentials";
      const status = message.includes("429") ? 429 : 401;
      return NextResponse.json(
        { success: false, error: message },
        { status }
      );
    }

    // Encrypt the password for at-rest storage
    const encryptedPassword = encrypt(torbox_password);

    // Create account with auth tokens
    const accountId = createAccount(
      session.userId,
      torbox_email,
      encryptedPassword,
      authResult.access_token,
      authResult.refresh_token,
      authResult.expires_at
    );

    if (!accountId) {
      return NextResponse.json(
        { success: false, error: "Failed to save account" },
        { status: 500 }
      );
    }

    // Automatically perform initial sync for the newly added account
    await syncAccount(accountId);
    const createdAccount = getAccountById(accountId);

    return NextResponse.json({
      success: true,
      account: {
        id: accountId,
        torbox_email,
        is_active: true,
        last_synced_at: createdAccount?.last_synced_at ?? null,
        last_updated_at: createdAccount?.last_updated_at ?? null,
      },
    });
  } catch (error) {
    console.error("Add account error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to add account. Please try again." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session.userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const accountIdParam = searchParams.get("account_id");

    if (!accountIdParam) {
      return NextResponse.json(
        { success: false, error: "account_id is required" },
        { status: 400 }
      );
    }

    const accountId = parseInt(accountIdParam, 10);
    const deleted = deleteAccount(session.userId, accountId);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Account not found or access denied" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete account error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete account" },
      { status: 500 }
    );
  }
}