"use client";

import { useEffect } from "react";
import Script from "next/script";
import { supabase } from "@/lib/supabaseClient";

const DEFAULT_CRISP_WEBSITE_ID = "90902ea5-80af-4468-8f9d-d9a808ed1137";

type ProfileRow = {
  full_name?: string | null;
};

type CrispWindow = Window & {
  $crisp?: unknown[];
  CRISP_WEBSITE_ID?: string;
};

const pushCrisp = (command: unknown[]) => {
  const crispWindow = window as CrispWindow;
  if (!crispWindow.$crisp) {
    crispWindow.$crisp = [];
  }

  crispWindow.$crisp.push(command);
};

export default function CrispChat() {
  const websiteId = process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID ?? DEFAULT_CRISP_WEBSITE_ID;

  useEffect(() => {
    let mounted = true;

    const syncVisitorIdentity = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) {
        return;
      }

      if (!user) {
        pushCrisp(["do", "session:reset", [false]]);
        return;
      }

      const email = typeof user.email === "string" ? user.email.trim() : "";
      let fullName =
        (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "") ||
        (typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "");

      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", user.id)
          .maybeSingle<ProfileRow>();

        if (mounted && profile?.full_name?.trim()) {
          fullName = profile.full_name.trim();
        }
      } catch {
        // Profile okunamazsa metadata/email fallback kullanılmaya devam eder.
      }

      if (email) {
        pushCrisp(["set", "user:email", [email]]);
      }

      if (fullName) {
        pushCrisp(["set", "user:nickname", [fullName]]);
      }

      pushCrisp([
        "set",
        "session:data",
        [
          {
            listflow_user_id: user.id,
            listflow_user_email: email || null,
          },
        ],
      ]);
    };

    void syncVisitorIdentity();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void syncVisitorIdentity();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!websiteId) {
    return null;
  }

  const crispBootstrap = `
    window.$crisp = window.$crisp || [];
    window.CRISP_WEBSITE_ID = "${websiteId}";
    (function () {
      if (document.getElementById("crisp-chat-script")) return;
      var d = document;
      var s = d.createElement("script");
      s.id = "crisp-chat-script";
      s.src = "https://client.crisp.chat/l.js";
      s.async = 1;
      d.getElementsByTagName("head")[0].appendChild(s);
    })();
  `;

  return <Script id="crisp-chat-bootstrap" strategy="afterInteractive" dangerouslySetInnerHTML={{ __html: crispBootstrap }} />;
}
