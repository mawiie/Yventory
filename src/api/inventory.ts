import { supabase } from "../lib/supabase";
import type {
  AppRole,
  Category,
  Collection,
  InventoryMovementAction,
  InventoryItem,
  ItemFormValues,
  ItemPhoto,
  Profile,
  StorageLocation,
  StockAdjustment,
  Tag,
} from "../types";

type RawInventoryItem = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  borrowed_quantity: number | null;
  created_at: string;
  updated_at: string;
  category: Category | Category[] | null;
  collection: RawCollection | RawCollection[] | null;
  location: StorageLocation | StorageLocation[] | null;
  location_details: string | null;
  item_tags: { tag: Tag | Tag[] | null }[] | null;
  item_photos: ItemPhoto[] | null;
};

type RawCollection = {
  id: string;
  name: string;
  location: StorageLocation | StorageLocation[] | null;
  location_details: string | null;
  created_at: string;
};

type RawStockAdjustment = Omit<StockAdjustment, "actor"> & {
  action_type?: InventoryMovementAction;
  recipient_name?: string | null;
  actor: Profile | Profile[] | null;
};

const cleanTag = (tag: string) => tag.trim().toLowerCase();

export function canManageInventory(role?: AppRole) {
  return role === "super_admin" || role === "admin" || role === "staff";
}

export function canManageStaff(role?: AppRole) {
  return role === "super_admin" || role === "admin";
}

export function canManageAdmins(role?: AppRole) {
  return role === "super_admin";
}

export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name,role")
    .order("email");

  if (error) throw error;
  return data ?? [];
}

export async function updateProfileRole(profileId: string, role: AppRole) {
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", profileId);

  if (error) throw error;
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,slug,position")
    .order("position");

  if (error) throw error;
  return data ?? [];
}

export async function fetchTags(): Promise<Tag[]> {
  const { data, error } = await supabase.from("tags").select("id,name").order("name");

  if (error) throw error;
  return data ?? [];
}

export async function fetchStorageLocations(): Promise<StorageLocation[]> {
  const { data, error } = await supabase
    .from("storage_locations")
    .select("id,name,is_default")
    .order("name");

  if (error) throw error;
  return data ?? [];
}

export async function createStorageLocation(name: string): Promise<StorageLocation> {
  const cleanedName = name.trim();
  if (!cleanedName) throw new Error("Location name is required.");

  const { data, error } = await supabase
    .from("storage_locations")
    .upsert({ name: cleanedName, is_default: false }, { onConflict: "name" })
    .select("id,name,is_default")
    .single();

  if (error) throw error;
  return data;
}

export async function fetchCollections(): Promise<Collection[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id,name,location_details,created_at,location:storage_locations(id,name,is_default)")
    .order("name");

  if (error) throw error;
  return ((data ?? []) as unknown as RawCollection[]).map(mapCollection);
}

export async function createCollection({
  name,
  locationId,
  locationDetails,
}: {
  name: string;
  locationId: string;
  locationDetails: string;
}): Promise<Collection> {
  const cleanedName = name.trim();
  if (!cleanedName) throw new Error("Collection name is required.");
  if (!locationId && !locationDetails.trim()) throw new Error("Collection location is required.");

  const { data, error } = await supabase
    .from("collections")
    .insert({
      name: cleanedName,
      location_id: locationId || null,
      location_details: locationDetails.trim() || null,
    })
    .select("id,name,location_details,created_at,location:storage_locations(id,name,is_default)")
    .single();

  if (error) throw error;
  return mapCollection(data as unknown as RawCollection);
}

export async function fetchInventory(includeUnavailable: boolean): Promise<InventoryItem[]> {
  let query = supabase
    .from("items")
    .select(
      "id,name,description,quantity,borrowed_quantity,created_at,updated_at,location_details,category:categories(id,name,slug,position),collection:collections(id,name,location_details,created_at,location:storage_locations(id,name,is_default)),location:storage_locations(id,name,is_default),item_tags(tag:tags(id,name)),item_photos(id,storage_path,alt_text)",
    )
    .order("updated_at", { ascending: false });

  if (!includeUnavailable) {
    query = query.gt("quantity", 0);
  }

  const { data, error } = await query;
  if (error) throw error;

  return addSignedPhotoUrls((data ?? []) as unknown as RawInventoryItem[]);
}

export async function fetchAdjustments(itemId: string): Promise<StockAdjustment[]> {
  const { data, error } = await supabase
    .from("stock_adjustments")
    .select("id,item_id,delta,action_type,recipient_name,note,created_at,actor:profiles(id,email,full_name,role)")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return ((data ?? []) as unknown as RawStockAdjustment[]).map((entry) => ({
    id: entry.id,
    item_id: entry.item_id,
    delta: entry.delta,
    actionType: entry.action_type ?? "adjustment",
    recipientName: entry.recipient_name ?? null,
    note: entry.note,
    created_at: entry.created_at,
    actor: single(entry.actor),
  }));
}

export async function createInventoryItem(values: ItemFormValues) {
  const tagIds = await ensureTags(parseTags(values.tags));

  const { data: item, error } = await supabase
    .from("items")
    .insert({
      name: values.name.trim(),
      description: values.description.trim() || null,
      quantity: values.quantity,
      category_id: values.categoryId || null,
      collection_id: values.collectionId || null,
      location_id: values.locationId || null,
      location_details: values.locationDetails.trim() || null,
    })
    .select("id")
    .single();

  if (error) throw error;

  if (tagIds.length > 0) {
    await replaceItemTags(item.id, tagIds);
  }

  if (values.quantity > 0) {
    const { error: adjustmentError } = await supabase.from("stock_adjustments").insert({
      item_id: item.id,
      delta: values.quantity,
      action_type: "initial_stock",
      note: "Initial intake",
    });
    if (adjustmentError) throw adjustmentError;
  }

  await uploadItemPhotos(item.id, values.photos);
  return item.id as string;
}

export async function updateInventoryItem(itemId: string, values: ItemFormValues) {
  const tagIds = await ensureTags(parseTags(values.tags));

  const { error } = await supabase
    .from("items")
    .update({
      name: values.name.trim(),
      description: values.description.trim() || null,
      category_id: values.categoryId || null,
      collection_id: values.collectionId || null,
      location_id: values.locationId || null,
      location_details: values.locationDetails.trim() || null,
    })
    .eq("id", itemId);

  if (error) throw error;

  await replaceItemTags(itemId, tagIds);
  await uploadItemPhotos(itemId, values.photos);
}

export async function deleteInventoryItem(item: InventoryItem) {
  const paths = item.photos.map((photo) => photo.storage_path);
  if (paths.length > 0) {
    await supabase.storage.from("inventory-photos").remove(paths);
  }

  const { error } = await supabase.from("items").delete().eq("id", item.id);
  if (error) throw error;
}

export async function recordInventoryMovement({
  itemId,
  action,
  quantity,
  recipientName,
  comment,
}: {
  itemId: string;
  action: Exclude<InventoryMovementAction, "initial_stock" | "adjustment">;
  quantity: number;
  recipientName?: string;
  comment?: string;
}) {
  const { error } = await supabase.rpc("adjust_item_quantity", {
    p_item_id: itemId,
    p_action: action,
    p_quantity: quantity,
    p_recipient_name: recipientName?.trim() || null,
    p_note: comment?.trim() || null,
  });

  if (error) throw error;
}

export async function inviteUser(email: string, role: AppRole, fullName: string) {
  const { error } = await supabase.functions.invoke("invite-user", {
    body: {
      email: email.trim(),
      role,
      fullName: fullName.trim() || null,
    },
  });

  if (error) throw error;
}

function parseTags(tags: string) {
  return Array.from(new Set(tags.split(",").map(cleanTag).filter(Boolean)));
}

async function ensureTags(tagNames: string[]) {
  if (tagNames.length === 0) return [];

  const rows = tagNames.map((name) => ({ name }));
  const { error: upsertError } = await supabase.from("tags").upsert(rows, {
    onConflict: "name",
    ignoreDuplicates: true,
  });

  if (upsertError) throw upsertError;

  const { data, error } = await supabase.from("tags").select("id,name").in("name", tagNames);
  if (error) throw error;

  return (data ?? []).map((tag) => tag.id as string);
}

async function replaceItemTags(itemId: string, tagIds: string[]) {
  const { error: deleteError } = await supabase.from("item_tags").delete().eq("item_id", itemId);
  if (deleteError) throw deleteError;

  if (tagIds.length === 0) return;

  const { error: insertError } = await supabase
    .from("item_tags")
    .insert(tagIds.map((tagId) => ({ item_id: itemId, tag_id: tagId })));

  if (insertError) throw insertError;
}

async function uploadItemPhotos(itemId: string, photos: File[]) {
  if (photos.length === 0) return;

  const uploads = photos.map(async (photo) => {
    const safeName = photo.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    const path = `${itemId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("inventory-photos")
      .upload(path, photo, { upsert: false });

    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase
      .from("item_photos")
      .insert({ item_id: itemId, storage_path: path, alt_text: photo.name });

    if (insertError) throw insertError;
  });

  await Promise.all(uploads);
}

async function addSignedPhotoUrls(rawItems: RawInventoryItem[]): Promise<InventoryItem[]> {
  const allPaths = rawItems.flatMap((item) =>
    (item.item_photos ?? []).map((photo) => photo.storage_path),
  );

  const signedUrls = new Map<string, string>();

  if (allPaths.length > 0) {
    const { data } = await supabase.storage.from("inventory-photos").createSignedUrls(allPaths, 3600);
    for (const result of data ?? []) {
      if (result.path && result.signedUrl) {
        signedUrls.set(result.path, result.signedUrl);
      }
    }
  }

  return rawItems.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    quantity: item.quantity,
    borrowedQuantity: item.borrowed_quantity ?? 0,
    created_at: item.created_at,
    updated_at: item.updated_at,
    category: single(item.category),
    collection: single(item.collection) ? mapCollection(single(item.collection) as RawCollection) : null,
    location: single(item.location),
    locationDetails: item.location_details,
    tags: (item.item_tags ?? []).flatMap((entry) => {
      const tag = single(entry.tag);
      return tag ? [tag] : [];
    }),
    photos: (item.item_photos ?? []).map((photo) => ({
      ...photo,
      signedUrl: signedUrls.get(photo.storage_path),
    })),
  }));
}

function mapCollection(collection: RawCollection): Collection {
  return {
    id: collection.id,
    name: collection.name,
    location: single(collection.location),
    locationDetails: collection.location_details,
    created_at: collection.created_at,
  };
}

function single<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}
