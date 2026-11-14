export interface BrandRedemptionTheme {
  brandName: string;
  imageUrl: string;
  accentHex: string;
  bannerGradient: string;
  borderGlow: string;
  pillClass: string;
  redeemUrl: string | null;
  redeemHost: string | null;
  redeemLabel: string;
  secondaryRedeemUrl?: string | null;
  secondaryRedeemLabel?: string | null;
  importantNote: string;
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
      redeemHost: "ec.nintendo.com/redeem",
      redeemLabel: "Canjear en Nintendo eShop",
      importantNote:
        "Tu cuenta Nintendo debe estar configurada en Estados Unidos (USA). Puedes canjearlo desde navegador web o directamente en tu consola Nintendo Switch.",
      steps: [
        "Entra a ec.nintendo.com/redeem desde tu navegador o abre Nintendo eShop en tu consola Switch.",
        "Inicia sesión con tu cuenta Nintendo (región Estados Unidos).",
        "Selecciona 'Canjear código', pega los 16 caracteres del PIN y confirma para acreditar tus fondos.",
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
      redeemHost: "store.playstation.com",
      redeemLabel: "Canjear en PlayStation Store",
      importantNote:
        "Válido únicamente para cuentas PlayStation Network (PSN) registradas con país Estados Unidos (USA).",
      steps: [
        "Entra a store.playstation.com o abre PlayStation Store desde tu consola PS4 o PS5.",
        "Haz clic en tu avatar arriba a la derecha y elige la opción 'Canjear código' (Redeem Code).",
        "Pega el código de 12 dígitos sin guiones y confirma para sumar el saldo a tu monedero PSN.",
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
      redeemUrl: "https://redeem.hype.games",
      redeemHost: "redeem.hype.games / pagostore.garena.com",
      redeemLabel: "Canjear PIN en Hype Redeem",
      secondaryRedeemUrl: "https://pagostore.garena.com",
      secondaryRedeemLabel: "Ir a PagoStore Garena",
      importantNote:
        "Si tu código tiene 36 caracteres con guiones (ej. CE4B2616-4D48-...), se canjea en redeem.hype.games ingresando tu código + tu ID de jugador de Free Fire. Si es un PIN numérico de Garena, se canjea en pagostore.garena.com. (No uses reward.ff.garena.com, esa página es solo para códigos de eventos de 12 letras).",
      steps: [
        "Copia tu código PIN arriba y haz clic en 'Canjear PIN en Hype Redeem' (redeem.hype.games) o entra a pagostore.garena.com.",
        "Pega el código PIN completo (incluyendo los guiones) y escribe tu ID numérico de jugador de Free Fire (lo encuentras en tu perfil dentro del juego).",
        "Verifica que aparezca tu apodo de jugador correcto y confirma el canje: los diamantes + el 10% de bono llegan al instante a tu cuenta.",
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
      redeemHost: "redeem.microsoft.com",
      redeemLabel: "Canjear en Microsoft Store",
      importantNote:
        "Tu cuenta Microsoft / Xbox debe tener región Estados Unidos (USA) al momento de canjear el código de 25 caracteres.",
      steps: [
        "Haz clic en 'Canjear en Microsoft Store' (redeem.microsoft.com) o abre la tienda en tu consola Xbox.",
        "Inicia sesión con tu cuenta Microsoft donde quieres recibir el saldo.",
        "Pega el código de 25 caracteres, haz clic en Siguiente y confirma la recarga.",
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
      redeemHost: "store.steampowered.com/account/redeemwalletcode",
      redeemLabel: "Canjear en Steam Wallet",
      importantNote:
        "Válido para cuentas de Steam cuya cartera esté configurada en dólares estadounidenses (USD).",
      steps: [
        "Entra directo a store.steampowered.com/account/redeemwalletcode o abre la app de Steam en tu PC.",
        "Ve a 'Juegos' -> 'Canjear un código de la Cartera de Steam'.",
        "Pega tu código en el recuadro y presiona Continuar para sumar el saldo a tu cartera.",
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
      redeemHost: "roblox.com/redeem",
      redeemLabel: "Canjear en Roblox.com",
      importantNote:
        "Los códigos de Roblox no se canjean dentro de la app móvil; debes entrar siempre desde el navegador web a roblox.com/redeem.",
      steps: [
        "Abre roblox.com/redeem desde el navegador de tu celular o PC.",
        "Inicia sesión en la cuenta de Roblox donde quieres acreditar tus Robux.",
        "Pega el código PIN en la casilla, pulsa 'Canjear' y luego convierte tu crédito a Robux.",
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
      redeemHost: "netflix.com/redeem",
      redeemLabel: "Canjear en Netflix.com",
      importantNote:
        "Compatible con cuentas de Netflix facturadas en USD.",
      steps: [
        "Entra a netflix.com/redeem desde cualquier navegador web.",
        "Pega el código PIN digital de arriba y haz clic en 'Canjear'.",
        "Inicia sesión en tu cuenta de Netflix para aplicar el saldo directamente a tu membresía.",
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
      redeemHost: "spotify.com/redeem",
      redeemLabel: "Canjear en Spotify.com",
      importantNote:
        "Tu cuenta de Spotify debe estar configurada en región USA. Aplica para planes Spotify Premium Individual.",
      steps: [
        "Entra a spotify.com/redeem e inicia sesión en tu cuenta.",
        "Pega el código PIN recibido y completa la verificación.",
        "Haz clic en 'Canjear' para activar tus meses de Spotify Premium.",
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
      redeemHost: "apps.apple.com/redeem",
      redeemLabel: "Canjear en App Store",
      importantNote:
        "Requiere un Apple ID cuya región de App Store sea Estados Unidos (USA).",
      steps: [
        "Abre la App Store en tu iPhone, iPad o Mac (o haz clic en 'Canjear en App Store').",
        "Toca tu foto de perfil arriba a la derecha y elige 'Canjear tarjeta regalo o código'.",
        "Pulsa 'Introducir el código manualmente' y pega el código de 16 caracteres.",
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
      redeemHost: "gold.razer.com",
      redeemLabel: "Canjear en Razer Gold",
      importantNote:
        "Válido para billeteras Razer Gold configuradas en USD Global.",
      steps: [
        "Inicia sesión en gold.razer.com con tu cuenta Razer ID.",
        "Haz clic en 'Reload Now' (Recargar) y selecciona 'Razer Gold PIN'.",
        "Pega tu código PIN y confirma la recarga en tu billetera.",
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
      redeemHost: "binance.com/es/gift-card",
      redeemLabel: "Canjear en Binance",
      importantNote:
        "Se acredita de inmediato sin comisiones en la Billetera de Fondos de tu cuenta Binance.",
      steps: [
        "Abre la app de Binance (Perfil -> Tarjeta de Regalo) o entra a binance.com/es/gift-card.",
        "Toca en 'Canjear' y elige 'Canjear a cripto'.",
        "Pega el código de 16 caracteres para recibir los USDT al instante.",
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
    redeemHost: null,
    redeemLabel: "Canjear en plataforma oficial",
    importantNote: "Verifica que la región de tu cuenta coincida con la región indicada en tu orden.",
    steps: [
      "Copia tu código digital usando el botón 'Copiar código'.",
      "Inicia sesión en la plataforma oficial correspondiente a tu tarjeta.",
      "Dirígete a la sección 'Canjear código / PIN' y pega los caracteres.",
    ],
  };
}
