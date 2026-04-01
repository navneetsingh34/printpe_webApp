import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PrinterLoading } from "../../shared/ui/PrinterLoading";
import { PrintShop } from "../../shared/types/shop";
import {
  getAllShops,
  getNearbyShops,
  searchShops,
} from "../../services/api/shopsApi";
import { getTokenBundle } from "../../services/storage/tokenStorage";
import {
  connectShopStatusSocket,
  ShopStatusChangedPayload,
  ShopStatusSnapshotPayload,
} from "../../services/realtime/shopStatusSocket";
import type { Socket } from "socket.io-client";

function formatDistance(distance?: number): string {
  if (distance === undefined || Number.isNaN(distance)) return "";
  if (distance < 1) return `${Math.round(distance * 1000)} m away`;
  return `${distance.toFixed(1)} km away`;
}

export function HomePage() {
  const navigate = useNavigate();
  const [shops, setShops] = useState<PrintShop[]>([]);
  const [nearbyShops, setNearbyShops] = useState<PrintShop[]>([]);
  const [mode, setMode] = useState<"all" | "nearby">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [shopOnlineMap, setShopOnlineMap] = useState<Record<string, boolean>>(
    {},
  );
  const socketRef = useRef<Socket | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError("");
    await (query.trim() ? searchShops(query.trim()) : getAllShops())
      .then((result) => setShops(result))
      .catch((e) => setError((e as Error).message || "Failed to load shops"))
      .finally(() => setLoading(false));
  };

  const loadNearby = async (coords?: { lat: number; lng: number }) => {
    setLocating(true);
    setError("");

    const runNearbyQuery = async (lat: number, lng: number) => {
      await getNearbyShops(lat, lng, 5)
        .then((result) => {
          const filtered = query.trim()
            ? result.filter((shop) =>
                shop.name.toLowerCase().includes(query.trim().toLowerCase()),
              )
            : result;
          setNearbyShops(filtered);
        })
        .catch((e) =>
          setError((e as Error).message || "Failed to load nearby shops"),
        )
        .finally(() => setLocating(false));
    };

    if (coords) {
      setLatLng(coords);
      await runNearbyQuery(coords.lat, coords.lng);
      return;
    }

    if (!navigator.geolocation) {
      setError("Location is not supported on this browser.");
      setLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setLatLng(next);
        void runNearbyQuery(next.lat, next.lng);
      },
      () => {
        setError(
          "Unable to access location. Please allow location permission.",
        );
        setLocating(false);
      },
    );
  };

  useEffect(() => {
    if (mode === "all") {
      void loadAll();
      return;
    }
    void loadNearby();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;

    const startSocket = async () => {
      const bundle = await getTokenBundle();
      if (!bundle?.accessToken || !mounted) return;

      const socket = connectShopStatusSocket(bundle.accessToken);
      socketRef.current = socket;

      socket.on("connect", () => {
        socket.emit("status:subscribe", {});
      });

      socket.on(
        "shops:status-snapshot",
        (payload: ShopStatusSnapshotPayload) => {
          if (!mounted) return;
          const next = payload.shops.reduce<Record<string, boolean>>(
            (acc, item) => {
              acc[item.shopId] = item.isOnline;
              return acc;
            },
            {},
          );
          setShopOnlineMap(next);
        },
      );

      socket.on("shop:status-changed", (payload: ShopStatusChangedPayload) => {
        if (!mounted) return;
        setShopOnlineMap((prev) => ({
          ...prev,
          [payload.shopId]: payload.isOnline,
        }));
      });
    };

    void startSocket();

    return () => {
      mounted = false;
      socketRef.current?.emit("status:unsubscribe");
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (mode === "nearby") {
        if (latLng) {
          void loadNearby(latLng);
        }
        return;
      }
      void loadAll();
    }, 45000);

    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, latLng, query]);

  const visibleShops = useMemo(
    () => (mode === "all" ? shops : nearbyShops),
    [mode, shops, nearbyShops],
  );

  const sortedShops = useMemo(() => {
    const arr = [...visibleShops];
    return arr.sort((a, b) => {
      const aIsOnline = shopOnlineMap[a.id] ?? a.isActive;
      const bIsOnline = shopOnlineMap[b.id] ?? b.isActive;
      if (aIsOnline !== bIsOnline) return aIsOnline ? -1 : 1;
      if (a.distance !== undefined && b.distance !== undefined) {
        return a.distance - b.distance;
      }
      return 0;
    });
  }, [visibleShops, shopOnlineMap]);

  const featuredShops = useMemo(() => sortedShops.slice(0, 2), [sortedShops]);
  const otherShops = useMemo(() => sortedShops.slice(2), [sortedShops]);

  const onSearchSubmit = async () => {
    if (mode === "nearby") {
      if (latLng) {
        await loadNearby(latLng);
      } else {
        await loadNearby();
      }
      return;
    }
    await loadAll();
  };

  if (loading || locating) {
    return (
      <section className="page-animate home-page">
        <div className="loader-screen">
          <PrinterLoading />
        </div>
      </section>
    );
  }

  return (
    <section className="page-animate home-page">
      <div className="home-header animate-rise delay-1">
        <h2>
          {mode === "all" ? "Discover Print Shops" : "Nearby Print Shops"}
        </h2>
        <p className="home-subtitle">
          {mode === "all"
            ? "Browse available print shops"
            : "Find shops near your location"}
        </p>
      </div>

      <div className="home-search card animate-rise delay-2">
        <div className="search-container">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onSearchSubmit();
              }
            }}
            placeholder="Search for a shop..."
            className="search-input"
          />
          <button
            className="btn-primary search-btn"
            type="button"
            onClick={() => void onSearchSubmit()}
          >
            <span>→</span>
          </button>
        </div>

        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === "all" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setMode("all");
              void loadAll();
            }}
          >
            All Shops
          </button>
          <button
            className={`mode-btn ${mode === "nearby" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setMode("nearby");
              if (latLng) {
                void loadNearby(latLng);
              } else {
                void loadNearby();
              }
            }}
          >
            Near Me
          </button>
        </div>
      </div>

      {error ? (
        <article className="card error animate-rise">{error}</article>
      ) : null}
      {!error && !visibleShops.length ? (
        <article className="card animate-rise">
          <p>No print shops found. Try adjusting your search or location.</p>
        </article>
      ) : null}

      {!error && featuredShops.length > 0 && (
        <>
          <div className="featured-label animate-rise delay-3">
            <span className="badge-dot" />
            Featured
          </div>
          <div className="shops-list">
            {featuredShops.map((shop, idx) => {
              const isOnline = shopOnlineMap[shop.id] ?? shop.isActive;
              return (
                <article
                  key={shop.id}
                  className={`shop-row shop-row--featured animate-rise`}
                  style={{ animationDelay: `${50 + idx * 80}ms` }}
                >
                  <div className="shop-name-status">
                    <h3>{shop.name}</h3>
                    <span
                      className={`status-badge-inline ${isOnline ? "online" : "offline"}`}
                    >
                      <span className="status-pulse" />
                      {isOnline ? "Online" : "Offline"}
                    </span>
                  </div>

                  <p className="address-inline">{shop.address}</p>

                  {shop.distance !== undefined && (
                    <span className="distance-inline">
                      {formatDistance(shop.distance)}
                    </span>
                  )}

                  <button
                    className="btn-primary btn-select-inline"
                    type="button"
                    disabled={!isOnline}
                    onClick={() => {
                      if (!isOnline) {
                        setError(
                          `${shop.name} is currently offline. Please choose an online shop.`,
                        );
                        return;
                      }
                      navigate(`/print?shopId=${encodeURIComponent(shop.id)}`);
                    }}
                  >
                    {isOnline ? "Select" : "Offline"}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}

      {otherShops.length > 0 && (
        <>
          <div className="other-label animate-rise delay-4">
            {otherShops.length} more shop{otherShops.length !== 1 ? "s" : ""}
          </div>
          <div className="shops-list">
            {otherShops.map((shop) => {
              const isOnline = shopOnlineMap[shop.id] ?? shop.isActive;
              return (
                <article key={shop.id} className="shop-row animate-rise">
                  <div className="shop-name-status">
                    <h3>{shop.name}</h3>
                  </div>

                  <p className="address-inline">{shop.address}</p>

                  <div className="shop-status-inline">
                    <span
                      className={`status-dot-inline ${isOnline ? "online" : "offline"}`}
                    />
                  </div>

                  {shop.distance !== undefined && (
                    <span className="distance-inline">
                      {formatDistance(shop.distance)}
                    </span>
                  )}

                  <button
                    className="btn-primary btn-select-inline"
                    type="button"
                    disabled={!isOnline}
                    onClick={() => {
                      if (!isOnline) {
                        setError(
                          `${shop.name} is currently offline. Please choose an online shop.`,
                        );
                        return;
                      }
                      navigate(`/print?shopId=${encodeURIComponent(shop.id)}`);
                    }}
                  >
                    Select
                  </button>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
