export type AppRole = "super_admin" | "admin" | "staff" | "user";

export type InventoryVisibility = "all" | "staff" | "admin";

export type InventoryMovementAction =
  | "initial_stock"
  | "add_stock"
  | "lend"
  | "give_out"
  | "adjustment";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  position: number;
};

export type Tag = {
  id: string;
  name: string;
};

export type StorageLocation = {
  id: string;
  name: string;
  is_default: boolean;
};

export type Collection = {
  id: string;
  name: string;
  visibility: InventoryVisibility;
  location: StorageLocation | null;
  locationDetails: string | null;
  created_at: string;
};

export type ItemPhoto = {
  id: string;
  storage_path: string;
  alt_text: string | null;
  signedUrl?: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  borrowedQuantity: number;
  created_at: string;
  updated_at: string;
  visibility: InventoryVisibility;
  category: Category | null;
  collection: Collection | null;
  location: StorageLocation | null;
  locationDetails: string | null;
  tags: Tag[];
  photos: ItemPhoto[];
};

export type StockAdjustment = {
  id: string;
  item_id: string;
  delta: number;
  actionType: InventoryMovementAction;
  recipientName: string | null;
  note: string | null;
  created_at: string;
  actor: Profile | null;
};

export type ItemFormValues = {
  name: string;
  description: string;
  quantity: number;
  categoryId: string;
  collectionId: string;
  visibility: InventoryVisibility;
  locationId: string;
  locationDetails: string;
  tags: string;
  photos: File[];
};
