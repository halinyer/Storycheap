export interface BrandRedemptionTheme {
  brandName: string;
  imageUrl: string;
  accentHex: string;
  bannerGradient: string;
  borderGlow: string;
  pillClass: string;
  redeemUrl: string | null;
  redeemLabel: string;
  steps: string[];
}

export function resolveBrandTheme(
  productName: string,
  productSlug?: string | null
): BrandRedemptionTheme {
  const haystack = `${productName} ${productSlug ?? ""}`.toLowerCase();

  if (haystack.includes("nintendo") || haystack.includes("eshop")) {
    return {
      brandName: "Nintendo eShop",
      imageUrl: "/cards/nintendo.png",
      accentHex: "#e60012",
      bannerGradient: "from-[#e60012]/30 via-[#99000c]/20 to-[#0e1017]",
      borderGlow: "border-rose-500/35 shadow-[0_20px_60px_-15px_rgba(230,0,18,0.28)]",
      pillClass: "bg-rose-500/20 border-rose-400/35 text-rose-200",
      redeemUrl: "https://ec.nintendo.com/redeem",
      redeemLabel: "Canjear en Nintendo eShop",
      steps: [
        "Abre Nintendo eShop en tu consola Switch o entra a ec.nintendo.com/redeem.",
        "Inicia sesión en tu cuenta Nintendo (verifica que coincida con la región del código).",
        "Selecciona 'Canjear código', pega los 16 dígitos y confirma la recarga.",
      ],
    };
  }

  if (haystack.includes("playstation") || haystack.includes("psn")) {
    return {
      brandName: "PlayStation Store",
      imageUrl: "/cards/playstation.png",
      accentHex: "#0070d1",
      bannerGradient: "from-[#0070d1]/35 via-[#003791]/20 to-[#0e1017]",
      borderGlow: "border-blue-500/35 shadow-[0_20px_60px_-15px_rgba(0,112,209,0.28)]",
      pillClass: "bg-blue-500/20 border-blue-400/35 text-blue-200",
      redeemUrl: "https://store.playstation.com",
      redeemLabel: "Canjear en PlayStation Store",
      steps: [
        "Inicia sesión en PlayStation Store desde tu consola PS4/PS5 o en store.playstation.com.",
        "Haz clic en tu avatar arriba a la derecha y selecciona 'Canjear código'.",
        "Pega el código de 12 caracteres y confirma para acreditar tu billetera PSN.",
      ],
    };
  }

  if (haystack.includes("free fire") || haystack.includes("freefire") || haystack.includes("garena")) {
    return {
      brandName: "Garena Free Fire",
      imageUrl: "/cards/freefire.png",
      accentHex: "#f59e0b",
      bannerGradient: "from-amber-500/30 via-orange-600/15 to-[#0e1017]",
      borderGlow: "border-amber-500/35 shadow-[0_20px_60px_-15px_rgba(245,158,11,0.25)]",
      pillClass: "bg-amber-500/20 border-amber-400/35 text-amber-200",
      redeemUrl: "https://pagostore.garena.com",
      redeemLabel: "Canjear en PagoStore Oficial",
      steps: [
        "Entra a pagostore.garena.com y selecciona el icono de Free Fire.",
        "Inicia sesión con tu ID de jugador (solo numérico, sin requerir contraseña).",
        "Elige el método 'Garena PPC / PIN', pega tu código de arriba y confirma tus diamantes.",
      ],
    };
  }

  if (haystack.includes("xbox") || haystack.includes("microsoft") || haystack.includes("game pass")) {
    return {
      brandName: "Xbox / Microsoft Store",
      imageUrl: "/cards/xbox.png",
      accentHex: "#107c10",
      bannerGradient: "from-emerald-600/30 via-green-900/20 to-[#0e1017]",
      borderGlow: "border-emerald-500/35 shadow-[0_20px_60px_-15px_rgba(16,124,16,0.28)]",
      pillClass: "bg-emerald-500/20 border-emerald-400/35 text-emerald-200",
      redeemUrl: "https://redeem.microsoft.com",
      redeemLabel: "Canjear en Microsoft Store",
      steps: [
        "Abre redeem.microsoft.com o entra a la tienda desde tu consola Xbox.",
        "Inicia sesión con tu cuenta Microsoft configurada en la región indicada.",
        "Pega el código de 25 caracteres y haz clic en Siguiente para activar tu saldo.",
      ],
    };
  }

  if (haystack.includes("steam")) {
    return {
      brandName: "Steam Wallet",
      imageUrl: "/cards/steam.png",
      accentHex: "#38bdf8",
      bannerGradient: "from-sky-600/30 via-slate-800/30 to-[#0e1017]",
      borderGlow: "border-sky-500/35 shadow-[0_20px_60px_-15px_rgba(56,189,248,0.25)]",
      pillClass: "bg-sky-500/20 border-sky-400/35 text-sky-200",
      redeemUrl: "https://store.steampowered.com/account/redeemwalletcode",
      redeemLabel: "Canjear en Steam Wallet",
      steps: [
        "Abre Steam o entra directo a store.steampowered.com/account/redeemwalletcode.",
        "Inicia sesión en tu cuenta de Steam.",
        "Pega el código en el campo 'Código de la Cartera de Steam' y presiona Continuar.",
      ],
    };
  }

  if (haystack.includes("roblox") || haystack.includes("robux")) {
    return {
      brandName: "Roblox",
      imageUrl: "/cards/roblox.png",
      accentHex: "#a855f7",
      bannerGradient: "from-purple-600/25 via-zinc-800/30 to-[#0e1017]",
      borderGlow: "border-purple-500/35 shadow-[0_20px_60px_-15px_rgba(168,85,247,0.25)]",
      pillClass: "bg-purple-500/20 border-purple-400/35 text-purple-200",
      redeemUrl: "https://www.roblox.com/redeem",
      redeemLabel: "Canjear en Roblox.com",
      steps: [
        "Ingresa a roblox.com/redeem desde tu navegador web.",
        "Inicia sesión en la cuenta de Roblox donde deseas acreditar tus Robux o saldo.",
        "Pega el código PIN y presiona 'Canjear'.",
      ],
    };
  }

  if (haystack.includes("netflix")) {
    return {
      brandName: "Netflix",
      imageUrl: "/cards/netflix.png",
      accentHex: "#e50914",
      bannerGradient: "from-[#e50914]/35 via-red-950/25 to-[#0e1017]",
      borderGlow: "border-red-500/35 shadow-[0_20px_60px_-15px_rgba(229,9,20,0.28)]",
      pillClass: "bg-red-500/20 border-red-400/35 text-red-200",
      redeemUrl: "https://www.netflix.com/redeem",
      redeemLabel: "Canjear en Netflix.com",
      steps: [
        "Visita netflix.com/redeem desde cualquier navegador.",
        "Pega el código digital de arriba y haz clic en 'Canjear'.",
        "Confirma la cuenta de Netflix donde deseas aplicar el saldo.",
      ],
    };
  }

  if (haystack.includes("spotify")) {
    return {
      brandName: "Spotify Premium",
      imageUrl: "/cards/spotify.png",
      accentHex: "#1db954",
      bannerGradient: "from-[#1db954]/30 via-emerald-950/25 to-[#0e1017]",
      borderGlow: "border-emerald-500/35 shadow-[0_20px_60px_-15px_rgba(29,185,84,0.28)]",
      pillClass: "bg-emerald-500/20 border-emerald-400/35 text-emerald-200",
      redeemUrl: "https://www.spotify.com/redeem",
      redeemLabel: "Canjear en Spotify.com",
      steps: [
        "Entra a spotify.com/redeem e inicia sesión en tu cuenta.",
        "Pega el PIN digital exactamente como aparece arriba.",
        "Presiona Continuar para activar tus meses de Spotify Premium.",
      ],
    };
  }

  if (haystack.includes("apple") || haystack.includes("itunes") || haystack.includes("app store")) {
    return {
      brandName: "Apple Gift Card",
      imageUrl: "/cards/apple.png",
      accentHex: "#60a5fa",
      bannerGradient: "from-indigo-500/25 via-slate-800/30 to-[#0e1017]",
      borderGlow: "border-indigo-400/35 shadow-[0_20px_60px_-15px_rgba(99,102,241,0.25)]",
      pillClass: "bg-indigo-500/20 border-indigo-400/35 text-indigo-200",
      redeemUrl: "https://apps.apple.com/redeem",
      redeemLabel: "Canjear en App Store",
      steps: [
        "Abre la App Store en tu iPhone, iPad o Mac (o haz clic en el botón de canje).",
        "Toca el icono de tu perfil arriba a la derecha y elige 'Canjear tarjeta o código'.",
        "Selecciona 'Introducir el código manualmente' y pega tus 16 caracteres.",
      ],
    };
  }

  if (haystack.includes("razer")) {
    return {
      brandName: "Razer Gold",
      imageUrl: "/cards/razer.png",
      accentHex: "#44d62c",
      bannerGradient: "from-lime-500/30 via-emerald-950/25 to-[#0e1017]",
      borderGlow: "border-lime-500/35 shadow-[0_20px_60px_-15px_rgba(68,214,44,0.28)]",
      pillClass: "bg-lime-500/20 border-lime-400/35 text-lime-200",
      redeemUrl: "https://gold.razer.com",
      redeemLabel: "Canjear en Razer Gold",
      steps: [
        "Inicia sesión en gold.razer.com con tu cuenta Razer ID.",
        "Haz clic en 'Recargar ahora' y elige Razer Gold PIN como método.",
        "Pega el código PIN y confirma tu saldo USD.",
      ],
    };
  }

  if (haystack.includes("binance") || haystack.includes("usdt")) {
    return {
      brandName: "Binance Gift Card",
      imageUrl: "/cards/binance.png",
      accentHex: "#f0b90b",
      bannerGradient: "from-yellow-500/30 via-amber-950/25 to-[#0e1017]",
      borderGlow: "border-yellow-500/35 shadow-[0_20px_60px_-15px_rgba(240,185,11,0.28)]",
      pillClass: "bg-yellow-500/20 border-yellow-400/35 text-yellow-200",
      redeemUrl: "https://www.binance.com/es/gift-card",
      redeemLabel: "Canjear en Binance",
      steps: [
        "Abre la app de Binance o entra a binance.com/es/gift-card.",
        "Selecciona 'Canjear' -> 'Canjear a cripto'.",
        "Pega el código de tu tarjeta de regalo para recibir el saldo al instante.",
      ],
    };
  }

  return {
    brandName: "StoryCheap Digital PIN",
    imageUrl: "/cards/nintendo.png",
    accentHex: "#6366f1",
    bannerGradient: "from-indigo-600/30 via-purple-900/20 to-[#0e1017]",
    borderGlow: "border-indigo-500/35 shadow-[0_20px_60px_-15px_rgba(99,102,241,0.25)]",
    pillClass: "bg-indigo-500/20 border-indigo-400/35 text-indigo-200",
    redeemUrl: null,
    redeemLabel: "Canjear en plataforma oficial",
    steps: [
      "Copia tu código digital usando el botón 'Copiar código'.",
      "Inicia sesión en la plataforma oficial correspondiente a tu tarjeta.",
      "Dirígete a la sección 'Canjear código / PIN' y pega los caracteres.",
    ],
  };
}
