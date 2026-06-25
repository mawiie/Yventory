import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Camera,
  Check,
  Filter,
  Gift,
  Layers,
  LogOut,
  MapPin,
  Menu,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import {
  canManageInventory,
  canManageAdmins,
  canManageStaff,
  createCollection,
  createStorageLocation,
  createInventoryItem,
  deleteInventoryItem,
  fetchAdjustments,
  fetchCategories,
  fetchCollections,
  fetchInventory,
  fetchProfile,
  fetchProfiles,
  fetchStorageLocations,
  fetchTags,
  inviteUser,
  recordInventoryMovement,
  updateInventoryItem,
  updateProfileRole,
} from "./api/inventory";
import { formatAppError } from "./lib/errors";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import type {
  AppRole,
  Category,
  Collection,
  InventoryMovementAction,
  InventoryItem,
  ItemFormValues,
  Profile,
  StorageLocation,
  StockAdjustment,
  Tag,
} from "./types";

const emptyForm: ItemFormValues = {
  name: "",
  description: "",
  quantity: 1,
  categoryId: "",
  collectionId: "",
  locationId: "",
  locationDetails: "",
  tags: "",
  photos: [],
};

type ViewMode = "catalog" | "staff" | "admin";

type ItemStatus = "available" | "low" | "out" | "lent";

const roleLabels: Record<AppRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  staff: "Staff",
  user: "Read-only",
};

function getItemStatus(item: InventoryItem): { state: ItemStatus; label: string } {
  if (item.quantity === 0 && item.borrowedQuantity > 0) {
    return { state: "lent", label: "Fully lent" };
  }
  if (item.quantity === 0) {
    return { state: "out", label: "Out of stock" };
  }
  if (item.quantity === 1) {
    return { state: "low", label: "Low stock" };
  }
  return { state: "available", label: "Available" };
}

function AppIcon({ size = "default" }: { size?: "default" | "large" }) {
  return <img className={`app-icon ${size === "large" ? "large" : ""}`} src="/ymen.jpeg" alt="" />;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch((error) => {
        setNotice(formatAppError(error, "Unable to restore session."));
      })
      .finally(() => {
        setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user.id) {
      setProfile(null);
      return;
    }

    fetchProfile(session.user.id)
      .then(setProfile)
      .catch((error) => setNotice(formatAppError(error, "Unable to load your profile.")));
  }, [session?.user.id]);

  if (!isSupabaseConfigured) {
    return <SetupScreen />;
  }

  if (loading) {
    return <ShellSkeleton />;
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <InventoryApp
      profile={profile}
      email={session.user.email ?? ""}
      notice={notice}
      onNotice={setNotice}
    />
  );
}

function InventoryApp({
  profile,
  email,
  notice,
  onNotice,
}: {
  profile: Profile | null;
  email: string;
  notice: string | null;
  onNotice: (message: string | null) => void;
}) {
  const [view, setView] = useState<ViewMode>("catalog");
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [activeItem, setActiveItem] = useState<InventoryItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [detailPaneWidth, setDetailPaneWidth] = useState(390);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const layoutRef = useRef<HTMLElement | null>(null);

  const role = profile?.role;
  const manageInventory = canManageInventory(role);
  const manageStaff = canManageStaff(role);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const includeUnavailable = manageInventory && view === "staff";
      const [nextCategories, nextCollections, nextLocations, nextTags, nextItems] = await Promise.all([
        fetchCategories(),
        fetchCollections(),
        fetchStorageLocations(),
        fetchTags(),
        fetchInventory(includeUnavailable),
      ]);
      setCategories(nextCategories);
      setCollections(nextCollections);
      setLocations(nextLocations);
      setTags(nextTags);
      setItems(nextItems);
      setActiveItem((current) => {
        if (!current) return current;
        return nextItems.find((item) => item.id === current.id) ?? null;
      });
    } catch (error) {
      onNotice(formatAppError(error, "Unable to load inventory."));
    } finally {
      setIsLoading(false);
    }
  }, [manageInventory, onNotice, view]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (view === "admin" && !manageStaff) {
      setView("catalog");
    }
    if (view === "staff" && !manageInventory) {
      setView("catalog");
    }
  }, [manageInventory, manageStaff, view]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return items.filter((item) => {
      const matchesCategory =
        selectedCategory === "all" || item.category?.id === selectedCategory;
      const matchesTag = selectedTag === "all" || item.tags.some((tag) => tag.id === selectedTag);
      const haystack = [item.name, item.description, item.category?.name, ...item.tags.map((tag) => tag.name)]
        .concat([item.collection?.name, item.location?.name, item.locationDetails])
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesCategory && matchesTag && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }, [items, query, selectedCategory, selectedTag]);

  const beginLayoutResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!layoutRef.current) return;
    const bounds = layoutRef.current.getBoundingClientRect();

    function resize(pointerEvent: PointerEvent) {
      const nextWidth = bounds.right - pointerEvent.clientX;
      setDetailPaneWidth(Math.min(680, Math.max(320, nextWidth)));
    }

    function stopResize() {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
    }

    event.preventDefault();
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand-group">
          <button
            className="icon-button sidebar-toggle"
            type="button"
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            <Menu size={21} />
          </button>
          <div className="brand">
            <AppIcon />
            <span>Yventory</span>
          </div>
          <p>NGO donated-item inventory and logistics</p>
        </div>
        <div className="account">
          <span>{profile?.full_name || email}</span>
          <span className="role-pill">{role ? roleLabels[role] : "Loading"}</span>
          <button className="icon-button" onClick={() => supabase.auth.signOut()} aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {notice ? (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button onClick={() => onNotice(null)} aria-label="Dismiss notice">
            <X size={16} />
          </button>
        </div>
      ) : null}

      <div className={`workspace-frame ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <nav className="tabs" aria-label="Main views">
          <span className="nav-section">Catalog</span>
          <button className={view === "catalog" ? "active" : ""} onClick={() => setView("catalog")} title="Catalog">
            <BookOpen size={17} />
            <span className="nav-label">Catalog</span>
          </button>
          {manageInventory ? (
            <>
              <span className="nav-section">Inventory</span>
              <button className={view === "staff" ? "active" : ""} onClick={() => setView("staff")} title="All items">
                <Package size={17} />
                <span className="nav-label">All items</span>
              </button>
            </>
          ) : null}
          {manageStaff ? (
            <>
              <span className="nav-section">Admin</span>
              <button className={view === "admin" ? "active" : ""} onClick={() => setView("admin")} title="Accounts">
                <Users size={17} />
                <span className="nav-label">Accounts</span>
              </button>
            </>
          ) : null}
        </nav>

        <div className="workspace-content">
          {!manageInventory ? <ReadOnlyAccessNotice email={email} /> : null}

          {view === "admin" ? (
            <AdminPanel currentProfile={profile} onNotice={onNotice} />
          ) : (
            <main
              className="inventory-layout"
              ref={layoutRef}
              style={{ "--detail-pane-width": `${detailPaneWidth}px` } as CSSProperties}
            >
              <section className="inventory-list" aria-label="Inventory">
                <div className="page-header">
                  <div>
                    <h1>{view === "staff" ? "Staff inventory" : "Catalog"}</h1>
                    <p>
                      {view === "staff"
                        ? "Add items, review locations, and record stock movements."
                        : "Browse available donated items by category, tag, location, or collection."}
                    </p>
                  </div>
                  <span className="item-count">{filteredItems.length} items</span>
                </div>
                <InventoryToolbar
                  categories={categories}
                  tags={tags}
                  selectedCategory={selectedCategory}
                  selectedTag={selectedTag}
                  query={query}
                  onCategoryChange={setSelectedCategory}
                  onTagChange={setSelectedTag}
                  onQueryChange={setQuery}
                />
                {view === "staff" && manageInventory ? (
                  <StaffCreatePanel
                    categories={categories}
                    collections={collections}
                    locations={locations}
                    onCreated={async () => {
                      onNotice("Item saved.");
                      await loadData();
                    }}
                    onNotice={onNotice}
                  />
                ) : null}
                <ItemGrid
                  items={filteredItems}
                  activeItem={activeItem}
                  loading={isLoading}
                  staffView={view === "staff" && manageInventory}
                  onSelect={setActiveItem}
                />
              </section>
              <div
                className="layout-resizer"
                role="separator"
                aria-label="Resize item details pane"
                aria-orientation="vertical"
                aria-valuemin={320}
                aria-valuemax={680}
                aria-valuenow={detailPaneWidth}
                onPointerDown={beginLayoutResize}
              />
              <aside className="detail-pane" aria-label="Item details">
                {activeItem ? (
                  <ItemDetail
                    item={activeItem}
                    categories={categories}
                    collections={collections}
                    locations={locations}
                    staffView={view === "staff" && manageInventory}
                    onNotice={onNotice}
                    onChanged={loadData}
                    onDeleted={() => {
                      setActiveItem(null);
                      loadData();
                    }}
                  />
                ) : (
                  <EmptyDetail staffView={view === "staff" && manageInventory} />
                )}
              </aside>
            </main>
          )}
        </div>
      </div>
    </div>
  );
}

function ReadOnlyAccessNotice({ email }: { email: string }) {
  return (
    <section className="access-notice" aria-label="Account access">
      <Shield size={18} aria-hidden="true" />
      <div>
        <strong>This account is read-only.</strong>
        <p>
          {email} can browse the catalog. Staff inventory and account controls appear only for
          staff and admin accounts.
        </p>
      </div>
    </section>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        setMessage("Account created. Check your email if confirmation is enabled.");
      }
    } catch (error) {
      setMessage(formatAppError(error, "Authentication failed."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand auth-brand">
          <AppIcon size="large" />
          <span>Yventory</span>
        </div>
        <h1>{mode === "signin" ? "Sign in" : "Create read-only account"}</h1>
        <p>Staff accounts are invited by an admin. Public signups receive catalog access.</p>
        <form onSubmit={submit} className="form-stack">
          {mode === "signup" ? (
            <label>
              Full name
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
            </label>
          ) : null}
          <label>
            Email
            <input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              required
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Working..." : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        {message ? <p className="form-message">{message}</p> : null}
        <button className="text-button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Create a read-only user account" : "Use an existing account"}
        </button>
      </section>
    </main>
  );
}

function InventoryToolbar({
  categories,
  tags,
  selectedCategory,
  selectedTag,
  query,
  onCategoryChange,
  onTagChange,
  onQueryChange,
}: {
  categories: Category[];
  tags: Tag[];
  selectedCategory: string;
  selectedTag: string;
  query: string;
  onCategoryChange: (categoryId: string) => void;
  onTagChange: (tagId: string) => void;
  onQueryChange: (query: string) => void;
}) {
  return (
    <div className="toolbar">
      <div className="category-tabs" role="tablist" aria-label="Categories">
        <button
          role="tab"
          aria-selected={selectedCategory === "all"}
          className={selectedCategory === "all" ? "active" : ""}
          onClick={() => onCategoryChange("all")}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            role="tab"
            aria-selected={selectedCategory === category.id}
            className={selectedCategory === category.id ? "active" : ""}
            onClick={() => onCategoryChange(category.id)}
          >
            {category.name}
          </button>
        ))}
      </div>
      <div className="filters">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            value={query}
            placeholder="Search items, locations, tags..."
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <label className="select-field">
          <Filter size={16} aria-hidden="true" />
          <select value={selectedTag} onChange={(event) => onTagChange(event.target.value)}>
            <option value="all">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

function StaffCreatePanel({
  categories,
  collections,
  locations,
  onCreated,
  onNotice,
}: {
  categories: Category[];
  collections: Collection[];
  locations: StorageLocation[];
  onCreated: () => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="staff-create">
      <button className="primary-button" onClick={() => setOpen((value) => !value)}>
        <Plus size={17} /> {open ? "Close item form" : "Add new item"}
      </button>
      {open ? (
        <ItemForm
          categories={categories}
          collections={collections}
          locations={locations}
          submitLabel="Save item"
          initialValues={emptyForm}
          onSubmit={async (values) => {
            await createInventoryItem(values);
            setOpen(false);
            await onCreated();
          }}
          onNotice={onNotice}
        />
      ) : null}
    </section>
  );
}

function ItemGrid({
  items,
  activeItem,
  loading,
  staffView,
  onSelect,
}: {
  items: InventoryItem[];
  activeItem: InventoryItem | null;
  loading: boolean;
  staffView: boolean;
  onSelect: (item: InventoryItem) => void;
}) {
  if (loading) {
    return (
      <div className="item-grid" aria-label="Loading inventory">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="item-card item-card-skeleton" key={index} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="empty-state">
        {staffView ? <PackagePlus size={52} aria-hidden="true" /> : <Package size={52} aria-hidden="true" />}
        <h2>{staffView ? "Nothing here yet" : "No items match this view"}</h2>
        <p>
          {staffView
            ? "Add your first item to start tracking inventory."
            : "Try a different search term, category, or tag filter."}
        </p>
      </div>
    );
  }

  return (
    <div className="item-grid">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} active={activeItem?.id === item.id} onSelect={onSelect} />
      ))}
    </div>
  );
}

function ItemCard({
  item,
  active,
  onSelect,
}: {
  item: InventoryItem;
  active: boolean;
  onSelect: (item: InventoryItem) => void;
}) {
  const status = getItemStatus(item);
  const visibleTags = item.tags.slice(0, 3);
  const hiddenTags = item.tags.length - visibleTags.length;

  return (
    <button
      className={`item-card status-${status.state} ${active ? "active" : ""}`}
      onClick={() => onSelect(item)}
    >
      <span className="sr-only">Status: {status.label}</span>
      <PhotoPreview item={item} />
      <span className="item-card-body">
        <span className="item-card-title">{item.name}</span>
        <span className="category-chip">{item.category?.name ?? "Uncategorized"}</span>
        <span className="quantity-row">
          <span>
            <small>Available</small>
            <strong>{item.quantity}</strong>
          </span>
          {item.borrowedQuantity > 0 ? (
            <span className="borrowed-qty">
              <small>Lent</small>
              <strong>{item.borrowedQuantity}</strong>
            </span>
          ) : null}
        </span>
        <span className="item-card-meta inline-meta">
          <MapPin size={13} aria-hidden="true" />
          {item.location?.name ?? item.locationDetails ?? "No location"}
        </span>
        {item.collection ? (
          <span className="collection-chip">
            <Layers size={13} aria-hidden="true" />
            {item.collection.name}
          </span>
        ) : null}
        {item.tags.length > 0 ? (
          <span className="card-badges">
            {visibleTags.map((tag) => (
              <span className="tag-chip" key={tag.id}>
                {tag.name}
              </span>
            ))}
            {hiddenTags > 0 ? <span className="tag-chip">+ {hiddenTags} more</span> : null}
          </span>
        ) : null}
        <span className={`stock-badge ${status.state}`}>{status.label}</span>
      </span>
    </button>
  );
}

function ItemDetail({
  item,
  categories,
  collections,
  locations,
  staffView,
  onNotice,
  onChanged,
  onDeleted,
}: {
  item: InventoryItem;
  categories: Category[];
  collections: Collection[];
  locations: StorageLocation[];
  staffView: boolean;
  onNotice: (message: string | null) => void;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [adjustAmount, setAdjustAmount] = useState("1");
  const [movementAction, setMovementAction] = useState<"add_stock" | "lend" | "give_out">("add_stock");
  const [movementRecipient, setMovementRecipient] = useState("");
  const [movementComment, setMovementComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState<StockAdjustment[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const formValues: ItemFormValues = {
    name: item.name,
    description: item.description ?? "",
    quantity: item.quantity,
    categoryId: item.category?.id ?? "",
    collectionId: item.collection?.id ?? "",
    locationId: item.location?.id ?? "",
    locationDetails: item.locationDetails ?? "",
    tags: item.tags.map((tag) => tag.name).join(", "),
    photos: [],
  };

  useEffect(() => {
    if (!staffView) return;
    setLoadingHistory(true);
    fetchAdjustments(item.id)
      .then(setHistory)
      .catch((error) => onNotice(formatAppError(error, "Unable to load adjustment history.")))
      .finally(() => setLoadingHistory(false));
  }, [item.id, onNotice, staffView]);

  async function submitMovement(event: React.FormEvent) {
    event.preventDefault();
    const amount = Math.max(1, Math.floor(Number(adjustAmount || "1")));
    if (movementAction !== "add_stock" && amount > item.quantity) {
      onNotice(`Only ${item.quantity} available. Adjust the quantity.`);
      return;
    }
    try {
      await recordInventoryMovement({
        itemId: item.id,
        action: movementAction,
        quantity: amount,
        recipientName: movementRecipient,
        comment: movementComment,
      });
      setMovementRecipient("");
      setMovementComment("");
      onNotice("Inventory movement recorded.");
      await onChanged();
      setLoadingHistory(true);
      setHistory(await fetchAdjustments(item.id));
    } catch (error) {
      onNotice(formatAppError(error, "Unable to record inventory movement."));
    } finally {
      setLoadingHistory(false);
    }
  }

  const movementAmount = Math.max(1, Math.floor(Number(adjustAmount || "1")));
  const movementExceedsAvailable = movementAction !== "add_stock" && movementAmount > item.quantity;
  const movementNeedsRecipient = movementAction !== "add_stock" && !movementRecipient.trim();
  const projectedAvailable =
    movementAction === "add_stock" ? item.quantity + movementAmount : Math.max(0, item.quantity - movementAmount);
  const projectedLent = movementAction === "lend" ? item.borrowedQuantity + movementAmount : item.borrowedQuantity;
  const quantityLabel =
    movementAction === "add_stock"
      ? "Quantity to add"
      : movementAction === "lend"
        ? "Quantity to lend"
        : "Quantity to give out";
  const movementSubmitDisabled = movementExceedsAvailable || movementNeedsRecipient;

  return (
    <div className="detail-content">
      <div className="detail-media">
        {item.photos[0]?.signedUrl ? (
          <img src={item.photos[0].signedUrl} alt={item.photos[0].alt_text ?? item.name} />
        ) : (
          <div className="photo-placeholder">
            <Camera size={28} />
          </div>
        )}
      </div>
      <div className="detail-header">
        <div>
          <p className="eyebrow">{item.category?.name ?? "Uncategorized"}</p>
          <h2>{item.name}</h2>
        </div>
        <div className="quantity-stack">
          <span className={`quantity-chip ${item.quantity === 0 ? "empty" : ""}`}>{item.quantity}</span>
          <small>available</small>
        </div>
      </div>
      <p className="description">{item.description || "No description recorded."}</p>
      <p className="location-line">
        Stored at <strong>{item.location?.name ?? item.locationDetails ?? "No location recorded"}</strong>
      </p>
      {item.collection ? (
        <p className="collection-line">
          Collection <strong>{item.collection.name}</strong>
        </p>
      ) : null}
      <div className="stock-summary">
        <span>{item.quantity} available</span>
        <span>{item.borrowedQuantity} borrowed</span>
      </div>
      <div className="tag-row">
        {item.tags.length > 0 ? item.tags.map((tag) => <span key={tag.id}>{tag.name}</span>) : <span>No tags</span>}
      </div>

      {item.photos.length > 1 ? (
        <div className="photo-strip">
          {item.photos.slice(1).filter((photo) => photo.signedUrl).map((photo) => (
            <img key={photo.id} src={photo.signedUrl} alt={photo.alt_text ?? item.name} />
          ))}
        </div>
      ) : null}

      {staffView ? (
        <>
          <section className="adjust-panel">
            <h3>Record inventory movement</h3>
            <form className="movement-form" onSubmit={submitMovement}>
              <div className="movement-actions" aria-label="Inventory movement type">
                <button
                  type="button"
                  className={`movement-add ${movementAction === "add_stock" ? "active" : ""}`}
                  onClick={() => setMovementAction("add_stock")}
                >
                  <Plus size={16} /> Add stock
                </button>
                <button
                  type="button"
                  className={`movement-lend ${movementAction === "lend" ? "active" : ""}`}
                  onClick={() => setMovementAction("lend")}
                >
                  <ArrowUpRight size={16} /> Lend
                </button>
                <button
                  type="button"
                  className={`movement-give ${movementAction === "give_out" ? "active" : ""}`}
                  onClick={() => setMovementAction("give_out")}
                >
                  <Gift size={16} /> Give out
                </button>
              </div>
              <div className="movement-grid">
                <label>
                  {quantityLabel}
                  <QuantityInput min={1} value={adjustAmount} onChange={setAdjustAmount} ariaLabel="Movement quantity" />
                </label>
                {movementAction !== "add_stock" ? (
                  <label>
                    {movementAction === "lend" ? "Lent to" : "Given to"}
                    <input
                      value={movementRecipient}
                      required
                      placeholder="Name or organisation"
                      onChange={(event) => setMovementRecipient(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
              {movementExceedsAvailable ? (
                <p className="field-error">Only {item.quantity} available. Adjust the quantity.</p>
              ) : null}
              <label>
                Comments
                <textarea
                  value={movementComment}
                  rows={2}
                  placeholder="Optional notes about this movement"
                  onChange={(event) => setMovementComment(event.target.value)}
                />
              </label>
              <div className="projected-result" aria-live="polite">
                <span>
                  Available after <strong>{projectedAvailable}</strong>
                </span>
                <span>
                  Lent after <strong>{projectedLent}</strong>
                </span>
              </div>
              <button className="primary-button" type="submit" disabled={movementSubmitDisabled}>
                <Check size={16} /> Record movement
              </button>
            </form>
          </section>

          <div className="detail-actions">
            <button className="secondary-button" onClick={() => setEditing((value) => !value)}>
              <Pencil size={16} /> {editing ? "Close edit" : "Edit item"}
            </button>
            <button
              className="danger-button"
              onClick={async () => {
                if (!window.confirm(`Delete ${item.name}?`)) return;
                try {
                  await deleteInventoryItem(item);
                  onNotice("Item deleted.");
                  onDeleted();
                } catch (error) {
                  onNotice(formatAppError(error, "Unable to delete item."));
                }
              }}
            >
              <Trash2 size={16} /> Delete
            </button>
          </div>

          {editing ? (
            <ItemForm
              categories={categories}
              collections={collections}
              locations={locations}
              initialValues={formValues}
              submitLabel="Save changes"
              lockQuantity
              onSubmit={async (values) => {
                await updateInventoryItem(item.id, values);
                setEditing(false);
                onNotice("Item updated.");
                await onChanged();
              }}
              onNotice={onNotice}
            />
          ) : null}

          <section className="history">
            <h3>Recent adjustments</h3>
            {loadingHistory ? <p>Loading history...</p> : null}
            {!loadingHistory && history.length === 0 ? <p>No adjustments recorded.</p> : null}
            {history.map((entry) => (
              <div key={entry.id} className="history-row">
                <span className={`movement-badge action-${entry.actionType}`}>
                  {movementLabel(entry.actionType)}
                </span>
                <span className={entry.delta > 0 ? "positive" : "negative"}>
                  {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                </span>
                <span>
                  {entry.recipientName ? ` · ${entry.recipientName}` : ""}
                </span>
                <small>
                  {entry.note || "No comments"} · {entry.actor?.email ?? "Unknown"} ·{" "}
                  {new Date(entry.created_at).toLocaleString()}
                </small>
              </div>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

function movementLabel(action: InventoryMovementAction) {
  const labels: Record<InventoryMovementAction, string> = {
    initial_stock: "Initial stock",
    add_stock: "Added stock",
    lend: "Lent out",
    give_out: "Given out",
    adjustment: "Adjustment",
  };

  return labels[action];
}

function ItemForm({
  categories,
  collections,
  locations,
  initialValues,
  submitLabel,
  lockQuantity = false,
  onSubmit,
  onNotice,
}: {
  categories: Category[];
  collections: Collection[];
  locations: StorageLocation[];
  initialValues: ItemFormValues;
  submitLabel: string;
  lockQuantity?: boolean;
  onSubmit: (values: ItemFormValues) => Promise<void>;
  onNotice: (message: string | null) => void;
}) {
  const [values, setValues] = useState<ItemFormValues>(initialValues);
  const [quantity, setQuantity] = useState(String(initialValues.quantity));
  const [availableLocations, setAvailableLocations] = useState<StorageLocation[]>(locations);
  const [availableCollections, setAvailableCollections] = useState<Collection[]>(collections);
  const [collectionChoice, setCollectionChoice] = useState(initialValues.collectionId);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [locationChoice, setLocationChoice] = useState(initialValues.locationId || (initialValues.locationDetails ? "__other__" : ""));
  const [customLocation, setCustomLocation] = useState(initialValues.locationDetails);
  const [savingLocation, setSavingLocation] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValues(initialValues);
    setQuantity(String(initialValues.quantity));
    setCollectionChoice(initialValues.collectionId);
    setNewCollectionName("");
    setLocationChoice(initialValues.locationId || (initialValues.locationDetails ? "__other__" : ""));
    setCustomLocation(initialValues.locationDetails);
  }, [initialValues]);

  useEffect(() => {
    setAvailableLocations(locations);
  }, [locations]);

  useEffect(() => {
    setAvailableCollections(collections);
  }, [collections]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const parsedQuantity = Number(quantity || "0");
      let nextValues = { ...values, quantity: parsedQuantity };
      if (!values.name.trim()) throw new Error("Item name is required.");
      if (collectionChoice === "__new__") {
        if (!newCollectionName.trim()) throw new Error("Collection name is required.");
        const collection = await createCollection({
          name: newCollectionName,
          locationId: values.locationId,
          locationDetails: values.locationDetails,
        });
        setAvailableCollections((current) => {
          const withoutDuplicate = current.filter((entry) => entry.id !== collection.id);
          return [...withoutDuplicate, collection].sort((a, b) => a.name.localeCompare(b.name));
        });
        nextValues = {
          ...nextValues,
          collectionId: collection.id,
          locationId: collection.location?.id ?? "",
          locationDetails: collection.locationDetails ?? "",
        };
      }
      if (!nextValues.locationId && !nextValues.locationDetails.trim()) {
        throw new Error("Storage location is required.");
      }
      if (!lockQuantity && parsedQuantity < 0) throw new Error("Quantity cannot be negative.");
      await onSubmit(nextValues);
      if (!lockQuantity) setValues(emptyForm);
      if (!lockQuantity) {
        setQuantity(String(emptyForm.quantity));
        setCollectionChoice("");
        setNewCollectionName("");
        setLocationChoice("");
        setCustomLocation("");
      }
    } catch (error) {
      onNotice(formatAppError(error, "Unable to save item."));
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomLocation() {
    setSavingLocation(true);
    try {
      const location = await createStorageLocation(customLocation);
      setAvailableLocations((current) => {
        const withoutDuplicate = current.filter((entry) => entry.id !== location.id);
        return [...withoutDuplicate, location].sort((a, b) => a.name.localeCompare(b.name));
      });
      setLocationChoice(location.id);
      setValues({ ...values, locationId: location.id, locationDetails: "" });
      setCustomLocation("");
      onNotice("Location saved.");
    } catch (error) {
      onNotice(formatAppError(error, "Unable to save location."));
    } finally {
      setSavingLocation(false);
    }
  }

  function addPhotos(files: File[]) {
    if (files.length === 0) return;
    setValues((current) => ({ ...current, photos: [...current.photos, ...files] }));
  }

  const selectedCollection =
    collectionChoice && collectionChoice !== "__new__"
      ? availableCollections.find((collection) => collection.id === collectionChoice) ?? null
      : null;
  const collectionControlsLocation = Boolean(selectedCollection);

  return (
    <form className="item-form" onSubmit={submit}>
      <div className="form-grid">
        <label>
          Name
          <input
            value={values.name}
            required
            onChange={(event) => setValues({ ...values, name: event.target.value })}
          />
        </label>
        <label>
          Category
          <select
            value={values.categoryId}
            required
            onChange={(event) => setValues({ ...values, categoryId: event.target.value })}
          >
            <option value="">Choose category</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Collection
          <select
            value={collectionChoice}
            onChange={(event) => {
              const nextCollection = event.target.value;
              setCollectionChoice(nextCollection);
              setNewCollectionName("");

              if (!nextCollection) {
                setValues({ ...values, collectionId: "" });
                return;
              }

              if (nextCollection === "__new__") {
                setValues({ ...values, collectionId: "" });
                return;
              }

              const collection = availableCollections.find((entry) => entry.id === nextCollection);
              setValues({
                ...values,
                collectionId: nextCollection,
                locationId: collection?.location?.id ?? "",
                locationDetails: collection?.locationDetails ?? "",
              });
              setLocationChoice(collection?.location?.id ?? (collection?.locationDetails ? "__other__" : ""));
              setCustomLocation(collection?.locationDetails ?? "");
            }}
          >
            <option value="">No collection</option>
            {availableCollections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
            <option value="__new__">Start new collection</option>
          </select>
        </label>
        <label>
          Quantity
          <QuantityInput min={0} value={quantity} onChange={setQuantity} disabled={lockQuantity} />
        </label>
        <label>
          Location
          <select
            value={locationChoice}
            required
            disabled={collectionControlsLocation}
            onChange={(event) => {
              const nextLocation = event.target.value;
              setLocationChoice(nextLocation);
              if (nextLocation === "__other__") {
                setValues({ ...values, locationId: "", locationDetails: customLocation });
                return;
              }
              setValues({ ...values, locationId: nextLocation, locationDetails: "" });
              setCustomLocation("");
            }}
          >
            <option value="">Choose location</option>
            {availableLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
            <option value="__other__">Other</option>
          </select>
        </label>
        <label>
          Tags
          <input
            value={values.tags}
            placeholder="food, canned, family"
            onChange={(event) => setValues({ ...values, tags: event.target.value })}
          />
        </label>
      </div>
      {collectionChoice === "__new__" ? (
        <label>
          New collection name
          <input
            value={newCollectionName}
            required
            placeholder="African trip items"
            onChange={(event) => setNewCollectionName(event.target.value)}
          />
        </label>
      ) : null}
      {selectedCollection ? (
        <div className="collection-location-callout">
          Store this item in{" "}
          <strong>{selectedCollection.location?.name ?? selectedCollection.locationDetails}</strong>
          , the location set for {selectedCollection.name}.
        </div>
      ) : null}
      {collectionControlsLocation ? null : (
        locationChoice === "__other__" ? (
          <div className="custom-location-row">
            <label>
              Other location details
              <input
                value={customLocation}
                required
                placeholder="Enter storage location"
                onChange={(event) => {
                  setCustomLocation(event.target.value);
                  setValues({ ...values, locationId: "", locationDetails: event.target.value });
                }}
              />
            </label>
            <button
              className="secondary-button"
              type="button"
              disabled={savingLocation || !customLocation.trim()}
              onClick={saveCustomLocation}
            >
              <Plus size={16} /> {savingLocation ? "Saving..." : "Save location"}
            </button>
          </div>
        ) : null
      )}
      <label>
        Description
        <textarea
          value={values.description}
          rows={3}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
      </label>
      <div className="photo-inputs">
        <label>
          Take photo
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(event) => addPhotos(Array.from(event.currentTarget.files ?? []))}
          />
        </label>
        <label>
          Upload photos
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => addPhotos(Array.from(event.currentTarget.files ?? []))}
          />
        </label>
      </div>
      <p className="selected-files">
        {values.photos.length > 0 ? `${values.photos.length} photo${values.photos.length === 1 ? "" : "s"} selected` : "No photos selected"}
      </p>
      <button className="primary-button" disabled={saving} type="submit">
        <Check size={16} /> {saving ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}

function QuantityInput({
  value,
  onChange,
  min,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  min: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <input
      type="number"
      min={min}
      inputMode="numeric"
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onFocus={() => {
        if (value === "0") onChange("");
      }}
      onChange={(event) => {
        const cleaned = event.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
        onChange(cleaned);
      }}
      onBlur={() => {
        if (value === "") onChange(String(min));
      }}
    />
  );
}

function AdminPanel({
  currentProfile,
  onNotice,
}: {
  currentProfile: Profile | null;
  onNotice: (message: string | null) => void;
}) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<AppRole>("staff");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminView, setAdminView] = useState<"accounts" | "admins">("accounts");
  const [loading, setLoading] = useState(true);
  const manageAdmins = canManageAdmins(currentProfile?.role);
  const accountProfiles = profiles.filter((profile) => profile.role !== "admin" && profile.role !== "super_admin");
  const adminProfiles = profiles.filter((profile) => profile.role === "admin" || profile.role === "super_admin");

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    try {
      setProfiles(await fetchProfiles());
    } catch (error) {
      onNotice(formatAppError(error, "Unable to load profiles."));
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    try {
      await inviteUser(email, role, fullName);
      setEmail("");
      setFullName("");
      setRole("staff");
      onNotice("Invitation sent.");
      await loadProfiles();
    } catch (error) {
      onNotice(formatAppError(error, "Unable to send invite."));
    }
  }

  async function sendAdminInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!manageAdmins) return;
    try {
      await inviteUser(adminEmail, "admin", adminFullName);
      setAdminEmail("");
      setAdminFullName("");
      onNotice("Admin invitation sent.");
      await loadProfiles();
    } catch (error) {
      onNotice(formatAppError(error, "Unable to send admin invite."));
    }
  }

  async function changeRole(profile: Profile, nextRole: AppRole) {
    if (profile.id === currentProfile?.id) {
      onNotice("Admins cannot change their own role.");
      return;
    }
    if ((profile.role === "admin" || profile.role === "super_admin") && !manageAdmins) {
      onNotice("Only super admins can change admin roles.");
      return;
    }
    if (nextRole === "admin" && !manageAdmins) {
      onNotice("Only super admins can create admin accounts.");
      return;
    }
    if (profile.role === "super_admin" || nextRole === "super_admin") {
      onNotice("Super admins can only be managed by the software administrator.");
      return;
    }
    try {
      await updateProfileRole(profile.id, nextRole);
      onNotice("Role updated.");
      await loadProfiles();
    } catch (error) {
      onNotice(formatAppError(error, "Unable to update role."));
    }
  }

  return (
    <main className="admin-page">
      <section className="admin-invite">
        <h2>Invite account</h2>
        <form className="form-grid" onSubmit={sendInvite}>
          <label>
            Full name
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </label>
          <label>
            Email
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as AppRole)}>
              <option value="staff">Staff</option>
              <option value="user">Read-only user</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            <UserPlus size={16} /> Send invite
          </button>
        </form>
      </section>

      <section className="profile-table">
        <div className="admin-section-header">
          <h2>{adminView === "admins" ? "Admins" : "Accounts"}</h2>
          {manageAdmins ? (
            <div className="admin-tabs" aria-label="Account management views">
              <button
                className={adminView === "accounts" ? "active" : ""}
                type="button"
                onClick={() => setAdminView("accounts")}
              >
                Accounts
              </button>
              <button
                className={adminView === "admins" ? "active" : ""}
                type="button"
                onClick={() => setAdminView("admins")}
              >
                Admins
              </button>
            </div>
          ) : null}
        </div>
        {loading ? <p>Loading accounts...</p> : null}
        {!loading && adminView === "accounts" && accountProfiles.length === 0 ? <p>No non-admin accounts found.</p> : null}
        {!loading && adminView === "admins" && adminProfiles.length === 0 ? <p>No admins found.</p> : null}

        {adminView === "admins" && manageAdmins ? (
          <form className="admin-invite-inline" onSubmit={sendAdminInvite}>
            <label>
              Admin name
              <input value={adminFullName} onChange={(event) => setAdminFullName(event.target.value)} />
            </label>
            <label>
              Admin email
              <input
                type="email"
                required
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
              />
            </label>
            <button className="primary-button" type="submit">
              <UserPlus size={16} /> Invite admin
            </button>
          </form>
        ) : null}

        {(adminView === "admins" ? adminProfiles : accountProfiles).map((profile) => {
          const isSelf = profile.id === currentProfile?.id;
          const isSuperAdmin = profile.role === "super_admin";
          const isAdminAccount = profile.role === "admin" || profile.role === "super_admin";
          const roleLocked = isSelf || isSuperAdmin || (isAdminAccount && !manageAdmins);

          return (
            <div key={profile.id} className="profile-row">
              <div>
                <strong>{profile.full_name || "No name"}</strong>
                <span>{profile.email}</span>
                {roleLocked ? (
                  <small>
                    {isSelf
                      ? "You cannot change your own role."
                      : isSuperAdmin
                        ? "Managed by the software administrator."
                        : "Only super admins can change admin roles."}
                  </small>
                ) : null}
              </div>
              <select
                value={profile.role}
                disabled={roleLocked}
                onChange={(event) => changeRole(profile, event.target.value as AppRole)}
              >
                {adminView === "admins" ? <option value="admin">Admin</option> : null}
                <option value="staff">Staff</option>
                <option value="user">Read-only user</option>
                {isSuperAdmin ? <option value="super_admin">Super admin</option> : null}
              </select>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function PhotoPreview({ item }: { item: InventoryItem }) {
  const photo = item.photos[0];
  if (photo?.signedUrl) {
    return <img className="item-thumb" src={photo.signedUrl} alt={photo.alt_text ?? item.name} />;
  }
  return (
    <span className="item-thumb placeholder">
      <Package size={26} aria-hidden="true" />
    </span>
  );
}

function EmptyDetail({ staffView }: { staffView: boolean }) {
  return (
    <div className="empty-detail">
      <Archive size={44} aria-hidden="true" />
      <h2>Select an item</h2>
      <p>{staffView ? "Review details, edit records, or adjust stock." : "Review availability and item details."}</p>
    </div>
  );
}

function SetupScreen() {
  return (
    <main className="auth-page">
      <section className="auth-panel setup-panel">
        <div className="brand auth-brand">
          <AppIcon size="large" />
          <span>Yventory</span>
        </div>
        <h1>Supabase configuration required</h1>
        <p>Create `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then restart Vite.</p>
      </section>
    </main>
  );
}

function ShellSkeleton() {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>Loading Yventory...</h1>
      </section>
    </main>
  );
}
