import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';

type MealType = 'Breakfast' | 'Lunch' | 'Dinner' | 'Snack';

type MealItem = {
  id: string;
  name: string;
  calories?: number;
  protein?: number; // grams
  carbs?: number;   // grams
  fat?: number;     // grams
  notes?: string;
};

type DayNutrition = {
  mealsByType: Record<MealType, MealItem[]>;
  waterOz: number;
};

type Goals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  waterOz: number;
};

// USDA FoodData Central types (subset as needed)
type FdcSearchItem = {
  fdcId: number;
  description: string;
  brandOwner?: string;
  dataType?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  labelNutrients?: {
    calories?: { value: number };
    protein?: { value: number };
    fat?: { value: number };
    carbohydrates?: { value: number };
  };
};

type FdcFoodNutrient = {
  amount?: number;
  nutrient?: {
    id?: number;
    number?: string;
    name?: string;
    unitName?: string;
  };
};

type FdcFoodDetails = {
  fdcId: number;
  description: string;
  brandOwner?: string;
  dataType?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  labelNutrients?: {
    calories?: { value: number };
    protein?: { value: number };
    fat?: { value: number };
    carbohydrates?: { value: number };
  };
  foodNutrients?: FdcFoodNutrient[];
};

type ServingSource =
  | {
      type: 'perServing';
      servingSize?: number;
      servingUnit?: string;
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
    }
  | {
      type: 'per100g';
      per100g: { calories?: number; protein?: number; carbs?: number; fat?: number };
    };

const STORAGE_NUTRITION_BY_DATE = '@pfa_nutrition_by_date_v1';
const STORAGE_NUTRITION_GOALS = '@pfa_nutrition_goals_v1';
const STORAGE_API_KEY = '@pfa_usda_api_key_v1';

const DEFAULT_GOALS: Goals = {
  calories: 2200,
  protein: 160,
  carbs: 220,
  fat: 70,
  waterOz: 64,
};

export default function NutritionScreen() {
  const [selectedDate, setSelectedDate] = React.useState<string>(getTodayISO());
  const [nutritionByDate, setNutritionByDate] = React.useState<Record<string, DayNutrition>>({});
  const [goals, setGoals] = React.useState<Goals>(DEFAULT_GOALS);
  const [mode, setMode] = React.useState<'Log' | 'Search'>('Log');

  const [mealModalVisible, setMealModalVisible] = React.useState(false);
  const [editingMealContext, setEditingMealContext] = React.useState<{ type: MealType; id: string | null } | null>(null);
  const [selectedMealType, setSelectedMealType] = React.useState<MealType>('Breakfast');
  const [mealForm, setMealForm] = React.useState({ name: '', calories: '', protein: '', carbs: '', fat: '', notes: '' });

  const [goalsModalVisible, setGoalsModalVisible] = React.useState(false);
  const [goalsForm, setGoalsForm] = React.useState({ calories: '', protein: '', carbs: '', fat: '', waterOz: '' });

  // Search state (USDA FoodData Central)
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchMealType, setSearchMealType] = React.useState<MealType>('Lunch');
  const [searchLoading, setSearchLoading] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [searchResults, setSearchResults] = React.useState<FdcSearchItem[]>([]);
  // Filters & sort
  const [selectedTypes, setSelectedTypes] = React.useState<string[]>([]);
  const [sortMode, setSortMode] = React.useState<'relevance' | 'calAsc' | 'calDesc'>('relevance');
  // Details modal (shows health facts + add controls)
  const [detailsModal, setDetailsModal] = React.useState<{
    visible: boolean;
    loading: boolean;
    error: string | null;
    item: { fdcId: number; name: string; source: ServingSource } | null;
    raw?: FdcFoodDetails | null;
  }>({ visible: false, loading: false, error: null, item: null, raw: null });
  const [servingModal, setServingModal] = React.useState<{
    visible: boolean;
    item: { fdcId: number; name: string; source: ServingSource } | null;
  }>({ visible: false, item: null });
  const [servingGrams, setServingGrams] = React.useState<string>(''); // for per100g
  const [servingsCount, setServingsCount] = React.useState<string>('1'); // for perServing
  const [waterModalVisible, setWaterModalVisible] = React.useState(false);
  const [waterInputOz, setWaterInputOz] = React.useState<string>('');
  const searchInputRef = React.useRef<TextInput>(null);
  const [runtimeApiKey, setRuntimeApiKey] = React.useState<string>('');
  const [runtimeApiKeyDraft, setRuntimeApiKeyDraft] = React.useState<string>('');

  React.useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const [rawByDate, rawGoals, savedApiKeyRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_NUTRITION_BY_DATE),
        AsyncStorage.getItem(STORAGE_NUTRITION_GOALS),
        AsyncStorage.getItem(STORAGE_API_KEY),
      ]);
      const parsedByDate: Record<string, DayNutrition> = rawByDate ? JSON.parse(rawByDate) : {};
      const parsedGoals: Goals = rawGoals ? JSON.parse(rawGoals) : DEFAULT_GOALS;
      // Ensure structure
      for (const date of Object.keys(parsedByDate)) {
        parsedByDate[date] = ensureDayNutritionShape(parsedByDate[date]);
      }
      setNutritionByDate(parsedByDate);
      setGoals(parsedGoals);
      const savedKey = (savedApiKeyRaw || '').trim();
      if (savedKey) setRuntimeApiKey(savedKey);
    } catch {}
  }

  function ensureDayNutritionShape(input?: Partial<DayNutrition>): DayNutrition {
    const base: DayNutrition = {
      mealsByType: { Breakfast: [], Lunch: [], Dinner: [], Snack: [] },
      waterOz: 0,
    };
    if (!input) return base;
    return {
      mealsByType: {
        Breakfast: input.mealsByType?.Breakfast ?? [],
        Lunch: input.mealsByType?.Lunch ?? [],
        Dinner: input.mealsByType?.Dinner ?? [],
        Snack: input.mealsByType?.Snack ?? [],
      },
      waterOz: typeof input.waterOz === 'number' ? input.waterOz : 0,
    };
  }

  const day = nutritionByDate[selectedDate] ?? ensureDayNutritionShape();

  const totals = React.useMemo(() => computeTotals(day), [day]);

  async function persistByDate(next: Record<string, DayNutrition>) {
    setNutritionByDate(next);
    try { await AsyncStorage.setItem(STORAGE_NUTRITION_BY_DATE, JSON.stringify(next)); } catch {}
  }

  async function persistGoals(next: Goals) {
    setGoals(next);
    try { await AsyncStorage.setItem(STORAGE_NUTRITION_GOALS, JSON.stringify(next)); } catch {}
  }

  function getUsdaApiKey(): string | null {
    const extra = (Constants as any)?.expoConfig?.extra
      ?? (Constants as any)?.manifestExtra
      ?? (Constants as any)?.manifest?.extra
      ?? null;
    const key = runtimeApiKey || (extra && (extra.USDA_API_KEY || extra.FOODDATA_API_KEY)) || null;
    return typeof key === 'string' ? key : null;
  }

  function openSearchForMeal(mt: MealType) {
    setSearchMealType(mt);
    setMode('Search');
    setTimeout(() => {
      try { searchInputRef.current?.focus(); } catch {}
    }, 0);
  }

  async function runFoodSearch() {
    const q = searchQuery.trim();
    if (!q) return;
    const apiKey = getUsdaApiKey();
    setSearchError(null);
    setSearchLoading(true);
    try {
      if (!apiKey) throw new Error('Missing USDA API key');
      const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}`;
      const body: any = { query: q, pageSize: 25 };
      if (selectedTypes.length > 0) body.dataType = selectedTypes;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
      }
      const data = await res.json();
      let items: FdcSearchItem[] = Array.isArray(data?.foods) ? data.foods : [];
      if (sortMode !== 'relevance') {
        items = items.slice().sort((a, b) => {
          const aCal = isFiniteNum(a.labelNutrients?.calories?.value) ? a.labelNutrients!.calories!.value : Number.NaN;
          const bCal = isFiniteNum(b.labelNutrients?.calories?.value) ? b.labelNutrients!.calories!.value : Number.NaN;
          if (Number.isNaN(aCal) && Number.isNaN(bCal)) return 0;
          if (Number.isNaN(aCal)) return 1;
          if (Number.isNaN(bCal)) return -1;
          return sortMode === 'calAsc' ? aCal - bCal : bCal - aCal;
        });
      }
      setSearchResults(items);
    } catch (e: any) {
      setSearchError(e?.message || 'Search failed');
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  async function fetchFoodDetails(fdcId: number): Promise<FdcFoodDetails> {
    const apiKey = getUsdaApiKey();
    if (!apiKey) throw new Error('Missing USDA API key');
    const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch details (${res.status}): ${text || res.statusText}`);
    }
    return await res.json();
  }

  function normalizeDetails(details: FdcFoodDetails, fromSearch?: FdcSearchItem): { fdcId: number; name: string; source: ServingSource } {
    const name = capitalize(details.description || fromSearch?.description || 'Food item');
    // Prefer branded label nutrients with serving
    if (details.labelNutrients && isFiniteNum(details.servingSize)) {
      const ln = details.labelNutrients;
      const source: ServingSource = {
        type: 'perServing',
        servingSize: details.servingSize,
        servingUnit: details.servingSizeUnit,
        calories: isFiniteNum(ln.calories?.value) ? ln.calories!.value : undefined,
        protein: isFiniteNum(ln.protein?.value) ? ln.protein!.value : undefined,
        carbs: isFiniteNum(ln.carbohydrates?.value) ? ln.carbohydrates!.value : undefined,
        fat: isFiniteNum(ln.fat?.value) ? ln.fat!.value : undefined,
      };
      return { fdcId: details.fdcId, name, source };
    }
    // Fall back to foodNutrients per 100g
    const per100g = extractPer100g(details.foodNutrients || []);
    const source: ServingSource = { type: 'per100g', per100g };
    return { fdcId: details.fdcId, name, source };
  }

  function extractPer100g(nutrients: FdcFoodNutrient[]): { calories?: number; protein?: number; carbs?: number; fat?: number } {
    let calories: number | undefined;
    let protein: number | undefined;
    let carbs: number | undefined;
    let fat: number | undefined;
    for (const fn of nutrients) {
      const id = fn.nutrient?.id;
      const num = (fn.nutrient?.number || '').toString();
      const unit = (fn.nutrient?.unitName || '').toUpperCase();
      const name = (fn.nutrient?.name || '').toLowerCase();
      const amt = isFiniteNum(fn.amount) ? fn.amount! : undefined;
      if (amt == null) continue;
      // Energy (prefer kcal; convert kJ if needed)
      if (calories == null && (id === 1008 || num === '1008' || num === '208' || name.includes('energy'))) {
        if (unit === 'KCAL' || unit === 'KILOCALORIES' || unit === 'KCALORIES' || unit === 'KCALORIE') {
          calories = amt;
        } else if (unit === 'KJ' || unit === 'KILOJOULES') {
          calories = amt * 0.239006;
        }
      }
      if (protein == null && (id === 1003 || num === '1003' || name.includes('protein')) && unit === 'G') {
        protein = amt;
      }
      if (fat == null && (id === 1004 || num === '1004' || name.includes('fat')) && unit === 'G') {
        fat = amt;
      }
      if (carbs == null && (id === 1005 || num === '1005' || name.includes('carbohydrate')) && unit === 'G') {
        carbs = amt;
      }
    }
    return { calories, protein, carbs, fat };
  }

  async function openServingFromSearch(item: FdcSearchItem) {
    const detail = await fetchFoodDetails(item.fdcId);
    const normalized = normalizeDetails(detail, item);
    if (normalized.source.type === 'per100g') {
      setServingGrams('100');
    } else {
      setServingsCount('1');
    }
    setServingModal({ visible: true, item: normalized });
  }

  function closeServingModal() {
    setServingModal({ visible: false, item: null });
  }

  async function openDetailsFromSearch(item: FdcSearchItem) {
    try {
      setDetailsModal({ visible: true, loading: true, error: null, item: null, raw: null });
      const detail = await fetchFoodDetails(item.fdcId);
      const normalized = normalizeDetails(detail, item);
      if (normalized.source.type === 'per100g') {
        setServingGrams('100');
      } else {
        setServingsCount('1');
      }
      setDetailsModal({ visible: true, loading: false, error: null, item: normalized, raw: detail });
    } catch (e: any) {
      setDetailsModal({ visible: true, loading: false, error: e?.message || 'Failed to load details', item: null, raw: null });
    }
  }

  function closeDetailsModal() {
    setDetailsModal({ visible: false, loading: false, error: null, item: null, raw: null });
  }

  function openWaterModal() {
    setWaterInputOz('');
    setWaterModalVisible(true);
  }

  function closeWaterModal() {
    setWaterModalVisible(false);
  }

  async function submitWater() {
    const oz = safeNum(waterInputOz) || 0;
    if (oz > 0) {
      await addWater(oz);
    }
    closeWaterModal();
  }

  function scaleFromSource(source: ServingSource, gramsOrServings: number) {
    if (source.type === 'perServing') {
      const f = gramsOrServings;
      return {
        calories: isFiniteNum(source.calories) ? source.calories! * f : undefined,
        protein: isFiniteNum(source.protein) ? source.protein! * f : undefined,
        carbs: isFiniteNum(source.carbs) ? source.carbs! * f : undefined,
        fat: isFiniteNum(source.fat) ? source.fat! * f : undefined,
      };
    } else {
      const f = gramsOrServings / 100;
      return {
        calories: isFiniteNum(source.per100g.calories) ? source.per100g.calories! * f : undefined,
        protein: isFiniteNum(source.per100g.protein) ? source.per100g.protein! * f : undefined,
        carbs: isFiniteNum(source.per100g.carbs) ? source.per100g.carbs! * f : undefined,
        fat: isFiniteNum(source.per100g.fat) ? source.per100g.fat! * f : undefined,
      };
    }
  }

  async function confirmServingAndSave(type: MealType, overrideItem?: { fdcId: number; name: string; source: ServingSource }) {
    const item = overrideItem || servingModal.item;
    if (!item) { closeServingModal(); return; }
    const quantity = item.source.type === 'perServing'
      ? (safeNum(servingsCount) || 0)
      : (safeNum(servingGrams) || 0);
    if (quantity <= 0) { closeServingModal(); return; }
    const scaled = scaleFromSource(item.source, quantity);
    const next = { ...nutritionByDate };
    const curr = ensureDayNutritionShape(next[selectedDate]);
    const list = [...curr.mealsByType[type]];
    list.push({
      id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8),
      name: item.name,
      calories: isFiniteNum(scaled.calories) ? roundSafe(scaled.calories) : undefined,
      protein: isFiniteNum(scaled.protein) ? roundSafe(scaled.protein) : undefined,
      carbs: isFiniteNum(scaled.carbs) ? roundSafe(scaled.carbs) : undefined,
      fat: isFiniteNum(scaled.fat) ? roundSafe(scaled.fat) : undefined,
      notes: item.source.type === 'perServing'
        ? `${roundSafe(quantity)} serving${quantity !== 1 ? 's' : ''}${item.source.servingSize ? ` (${roundSafe(item.source.servingSize)}${item.source.servingUnit || ''})` : ''}`
        : `${roundSafe(quantity)}g serving`,
    });
    curr.mealsByType[type] = list;
    next[selectedDate] = curr;
    await persistByDate(next);
    closeServingModal();
    closeDetailsModal();
  }

  function goPrevDay() {
    setSelectedDate(minusOneDay(selectedDate));
  }

  function goNextDay() {
    setSelectedDate(plusOneDay(selectedDate));
  }

  function goToday() {
    setSelectedDate(getTodayISO());
  }

  function openAddMeal(type: MealType) {
    setSelectedMealType(type);
    setEditingMealContext({ type, id: null });
    setMealForm({ name: '', calories: '', protein: '', carbs: '', fat: '', notes: '' });
    setMealModalVisible(true);
  }

  function openEditMeal(type: MealType, item: MealItem) {
    setSelectedMealType(type);
    setEditingMealContext({ type, id: item.id });
    setMealForm({
      name: item.name,
      calories: item.calories != null ? String(item.calories) : '',
      protein: item.protein != null ? String(item.protein) : '',
      carbs: item.carbs != null ? String(item.carbs) : '',
      fat: item.fat != null ? String(item.fat) : '',
      notes: item.notes ?? '',
    });
    setMealModalVisible(true);
  }

  function closeMealModal() {
    setMealModalVisible(false);
  }

  function onMealFormChange<K extends keyof typeof mealForm>(key: K, value: (typeof mealForm)[K]) {
    setMealForm(prev => ({ ...prev, [key]: value }));
  }

  async function addOrSaveMeal() {
    if (!mealForm.name.trim()) return;
    const next = { ...nutritionByDate };
    const curr = ensureDayNutritionShape(next[selectedDate]);
    const list = [...curr.mealsByType[selectedMealType]];

    if (editingMealContext && editingMealContext.id) {
      const idx = list.findIndex(x => x.id === editingMealContext.id);
      if (idx >= 0) {
        list[idx] = {
          id: editingMealContext.id,
          name: mealForm.name.trim(),
          calories: safeNum(mealForm.calories),
          protein: safeNum(mealForm.protein),
          carbs: safeNum(mealForm.carbs),
          fat: safeNum(mealForm.fat),
          notes: mealForm.notes.trim() || undefined,
        };
      }
    } else {
      list.push({
        id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8),
        name: mealForm.name.trim(),
        calories: safeNum(mealForm.calories),
        protein: safeNum(mealForm.protein),
        carbs: safeNum(mealForm.carbs),
        fat: safeNum(mealForm.fat),
        notes: mealForm.notes.trim() || undefined,
      });
    }

    curr.mealsByType[selectedMealType] = list;
    next[selectedDate] = curr;
    await persistByDate(next);
    closeMealModal();
  }

  async function removeMeal(type: MealType, id: string) {
    const next = { ...nutritionByDate };
    const curr = ensureDayNutritionShape(next[selectedDate]);
    curr.mealsByType[type] = curr.mealsByType[type].filter(x => x.id !== id);
    next[selectedDate] = curr;
    await persistByDate(next);
  }

  async function addWater(ozDelta: number) {
    const next = { ...nutritionByDate };
    const curr = ensureDayNutritionShape(next[selectedDate]);
    const updated = Math.max(0, (curr.waterOz || 0) + ozDelta);
    curr.waterOz = updated;
    next[selectedDate] = curr;
    await persistByDate(next);
  }

  function openGoalsModal() {
    setGoalsForm({
      calories: String(goals.calories),
      protein: String(goals.protein),
      carbs: String(goals.carbs),
      fat: String(goals.fat),
      waterOz: String(goals.waterOz),
    });
    setGoalsModalVisible(true);
  }

  function closeGoalsModal() {
    setGoalsModalVisible(false);
  }

  async function saveGoals() {
    const next: Goals = {
      calories: clampNum(safeNum(goalsForm.calories), 0, 99999),
      protein: clampNum(safeNum(goalsForm.protein), 0, 1000),
      carbs: clampNum(safeNum(goalsForm.carbs), 0, 1000),
      fat: clampNum(safeNum(goalsForm.fat), 0, 1000),
      waterOz: clampNum(safeNum(goalsForm.waterOz), 0, 300),
    };
    await persistGoals(next);
    closeGoalsModal();
  }

  const caloriePct = percent(totals.calories, goals.calories);
  const proteinPct = percent(totals.protein, goals.protein);
  const carbsPct = percent(totals.carbs, goals.carbs);
  const fatPct = percent(totals.fat, goals.fat);
  const waterPct = percent(day.waterOz, goals.waterOz);
  const hasApiKey = !!getUsdaApiKey();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
          <View style={styles.headerCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.headerTitle}>Nutrition</Text>
              <TouchableOpacity onPress={openGoalsModal} style={[styles.button, styles.secondaryButton]}>
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Edit Goals</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dateRow}>
              <TouchableOpacity onPress={goPrevDay} style={styles.iconButton}>
                <Ionicons name="chevron-back" size={20} color="#111827" />
              </TouchableOpacity>
              <TouchableOpacity onPress={goToday}>
                <Text style={styles.dateText}>{formatPrettyDate(selectedDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={goNextDay} style={styles.iconButton}>
                <Ionicons name="chevron-forward" size={20} color="#111827" />
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: 8 }}>
              <Text style={styles.metricLabel}>Calories</Text>
              <ProgressBar pct={caloriePct} color="#111827" />
              <Text style={styles.metricValue}>{Math.round(totals.calories)}/{goals.calories} kcal</Text>
            </View>

            <View style={styles.macrosRow}>
              <MacroProgress label="Protein" value={totals.protein} goal={goals.protein} color="#10B981" />
              <MacroProgress label="Carbs" value={totals.carbs} goal={goals.carbs} color="#3B82F6" />
              <MacroProgress label="Fat" value={totals.fat} goal={goals.fat} color="#F59E0B" />
            </View>

            {/* Segmented control for Log vs Search */}
            <View style={{ flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 999, padding: 4, marginTop: 12 }}>
              {(['Log','Search'] as const).map(m => (
                <TouchableOpacity key={m} onPress={() => setMode(m)} style={{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 999, backgroundColor: mode === m ? '#111827' : 'transparent' }}>
                  <Text style={{ fontWeight: '700', color: mode === m ? '#FFF' : '#111827' }}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Search Foods (API Ninjas Nutrition) */}
          {mode === 'Search' && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Search Foods</Text>
            </View>
            {!hasApiKey ? (
              <View style={{ marginHorizontal: 16, padding: 12, backgroundColor: '#FEF3C7', borderRadius: 12 }}>
                <Text style={{ color: '#92400E', fontWeight: '700' }}>USDA API key missing</Text>
                <Text style={{ color: '#92400E' }}>Paste your key or set USDA_API_KEY in env and restart.</Text>
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <TextInput
                    value={runtimeApiKeyDraft}
                    onChangeText={setRuntimeApiKeyDraft}
                    placeholder="USDA API key"
                    style={[styles.input, { flex: 1 }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={{ width: 8 }} />
                  <TouchableOpacity onPress={async () => { const t = runtimeApiKeyDraft.trim(); if (t) { setRuntimeApiKey(t); try { await AsyncStorage.setItem(STORAGE_API_KEY, t); } catch {} setRuntimeApiKeyDraft(''); } }} style={[styles.button, styles.primaryButton]}>
                    <Text style={styles.buttonText}>Save Key</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
            <View style={{ paddingHorizontal: 16 }}>
              <Text style={styles.inputLabel}>What did you eat?</Text>
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="e.g. chicken breast, rice, greek yogurt"
                style={styles.input}
                ref={searchInputRef}
                returnKeyType="search"
                onSubmitEditing={runFoodSearch}
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                {(['Breakfast','Lunch','Dinner','Snack'] as MealType[]).map(mt => (
                  <TouchableOpacity
                    key={mt}
                    onPress={() => setSearchMealType(mt)}
                    style={[styles.smallChip, { backgroundColor: mt === searchMealType ? '#111827' : '#E5E7EB' }]}
                  >
                    <Text style={{ fontWeight: '700', color: mt === searchMealType ? '#FFF' : '#111827' }}>{mt}</Text>
                  </TouchableOpacity>
                ))}
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={runFoodSearch} style={[styles.button, styles.primaryButton]}>
                  <Text style={styles.buttonText}>Search</Text>
                </TouchableOpacity>
              </View>

            </View>

            <View style={{ marginTop: 8 }}>
              {searchLoading ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <ActivityIndicator />
                  <Text style={styles.metricValue}>Searching…</Text>
                </View>
              ) : searchError ? (
                <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text style={{ color: '#EF4444' }}>{searchError}</Text>
                </View>
              ) : searchResults.length === 0 ? (
                <View style={styles.emptyStateSmall}>
                  <Text style={styles.emptySubtitle}>No results yet</Text>
                </View>
              ) : (
                <View style={{ paddingBottom: 8 }}>
                  {searchResults.map((it, idx) => (
                    <View key={idx} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                          <Text style={styles.cardTitle} numberOfLines={2}>{capitalize(it.description || 'Food item')}</Text>
                          {!!it.brandOwner && (
                            <Text style={{ color: '#6B7280', marginTop: 2 }} numberOfLines={1}>
                              {it.brandOwner}
                            </Text>
                          )}
                        </View>
                        <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
                          <Text style={{ fontWeight: '800', color: '#111827' }}>
                            {isFiniteNum(it.labelNutrients?.calories?.value) ? `${roundSafe(it.labelNutrients!.calories!.value)} kcal` : '—'}
                          </Text>
                          <TouchableOpacity onPress={() => openDetailsFromSearch(it)} style={[styles.button, styles.secondaryButton, { marginTop: 8 }]}>
                            <Text style={[styles.buttonText, styles.secondaryButtonText]}>Details</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {/* Keep list simple; full facts shown in Details */}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
          )}

          {(['Breakfast','Lunch','Dinner','Snack'] as MealType[]).map(type => (
            <View key={type} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{type}</Text>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity onPress={() => openSearchForMeal(type)} style={[styles.smallChip, { backgroundColor: '#111827' }]}>
                    <Text style={{ fontWeight: '700', color: '#FFF' }}>Search</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openAddMeal(type)} style={[styles.smallChip, { backgroundColor: '#E5E7EB' }]}>
                    <Text style={{ fontWeight: '700', color: '#111827' }}>Manual</Text>
                  </TouchableOpacity>
                </View>
              </View>
              {day.mealsByType[type].length === 0 ? (
                <View style={styles.emptyStateSmall}>
                  <Text style={styles.emptySubtitle}>No items</Text>
                </View>
              ) : (
                <View style={{ paddingBottom: 8 }}>
                  {day.mealsByType[type].map(item => (
                    <View key={item.id} style={styles.card}>
                      <View style={styles.cardHeader}>
                        <Text style={styles.cardTitle}>{item.name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <TouchableOpacity onPress={() => openEditMeal(type, item)} style={{ marginRight: 16 }}>
                            <Text style={{ color: '#111827', fontWeight: '700' }}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => removeMeal(type, item.id)}>
                            <Text style={styles.deleteText}>Remove</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      <Text style={styles.cardMeta}>
                        {item.calories != null ? `${round(item.calories)} kcal` : '—'}
                        {renderMacroInline(item)}
                      </Text>
                      {item.notes ? <Text style={styles.cardNotes}>{item.notes}</Text> : null}
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Water</Text>
              <View style={{ flexDirection: 'row' }}>
                <TouchableOpacity onPress={() => addWater(-8)} style={[styles.smallChip, { backgroundColor: '#E5E7EB' }]}>
                  <Text style={{ fontWeight: '700', color: '#111827' }}>-8oz</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => addWater(8)} style={[styles.smallChip, { backgroundColor: '#111827' }]}>
                  <Text style={{ fontWeight: '700', color: '#FFF' }}>+8oz</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => addWater(16)} style={[styles.smallChip, { backgroundColor: '#111827' }]}>
                  <Text style={{ fontWeight: '700', color: '#FFF' }}>+16oz</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={openWaterModal} style={[styles.smallChip, { backgroundColor: '#111827' }]}>
                  <Text style={{ fontWeight: '700', color: '#FFF' }}>+ oz…</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ProgressBar pct={waterPct} color="#06B6D4" />
            <Text style={styles.metricValue}>{round(day.waterOz)}/{goals.waterOz} oz</Text>
          </View>

        </ScrollView>

        <Modal visible={mealModalVisible} animationType="slide" transparent onRequestClose={closeMealModal}>
          <View style={styles.modalRoot} pointerEvents="box-none">
            <Pressable style={styles.modalBackdrop} onPress={closeMealModal} />
            <KeyboardAvoidingView
              behavior={Platform.select({ ios: 'padding', android: undefined })}
              style={styles.modalContainer}
              pointerEvents="box-none"
            >
              <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>{editingMealContext?.id ? 'Edit Item' : `Add to ${selectedMealType}`}</Text>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.inputLabel}>Name</Text>
                <TextInput value={mealForm.name} onChangeText={t => onMealFormChange('name', t)} placeholder="Chicken Bowl" style={styles.input} />

                <View style={styles.row}>
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Calories</Text>
                    <TextInput value={mealForm.calories} onChangeText={t => onMealFormChange('calories', onlyNum(t))} placeholder="600" style={styles.input} keyboardType="number-pad" />
                  </View>
                  <View style={styles.rowSpacer} />
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Protein (g)</Text>
                    <TextInput value={mealForm.protein} onChangeText={t => onMealFormChange('protein', onlyNum(t))} placeholder="40" style={styles.input} keyboardType="number-pad" />
                  </View>
                </View>

                <View style={styles.row}>
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Carbs (g)</Text>
                    <TextInput value={mealForm.carbs} onChangeText={t => onMealFormChange('carbs', onlyNum(t))} placeholder="70" style={styles.input} keyboardType="number-pad" />
                  </View>
                  <View style={styles.rowSpacer} />
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Fat (g)</Text>
                    <TextInput value={mealForm.fat} onChangeText={t => onMealFormChange('fat', onlyNum(t))} placeholder="20" style={styles.input} keyboardType="number-pad" />
                  </View>
                </View>

                <Text style={styles.inputLabel}>Notes (optional)</Text>
                <TextInput value={mealForm.notes} onChangeText={t => onMealFormChange('notes', t)} placeholder="No dressing" style={[styles.input, styles.notesInput]} multiline />
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity onPress={closeMealModal} style={[styles.button, styles.secondaryButton]}>
                  <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={addOrSaveMeal} style={[styles.button, styles.primaryButton]}>
                  <Text style={styles.buttonText}>{editingMealContext?.id ? 'Save' : 'Add'}</Text>
                </TouchableOpacity>
              </View>
              </Pressable>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        {/* Food details & add modal (USDA) */}
        <Modal visible={detailsModal.visible} animationType="slide" transparent onRequestClose={closeDetailsModal}>
          <View style={styles.modalRoot} pointerEvents="box-none">
            <Pressable style={styles.modalBackdrop} onPress={closeDetailsModal} />
            <KeyboardAvoidingView
              behavior={Platform.select({ ios: 'padding', android: undefined })}
              style={styles.modalContainer}
              pointerEvents="box-none"
            >
              <Pressable style={styles.modalCard} onPress={() => {}}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.modalTitle}>Food details</Text>
                <TouchableOpacity onPress={closeDetailsModal} style={{ padding: 8 }}>
                  <Ionicons name="close" size={20} color="#111827" />
                </TouchableOpacity>
              </View>
              {detailsModal.loading ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <ActivityIndicator />
                  <Text style={styles.metricValue}>Loading…</Text>
                </View>
              ) : detailsModal.error ? (
                <View style={{ paddingVertical: 12 }}>
                  <Text style={{ color: '#EF4444' }}>{detailsModal.error}</Text>
                </View>
              ) : detailsModal.item ? (
                <>
                  <Text style={styles.inputLabel}>Item</Text>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#111' }}>{capitalize(detailsModal.item.name)}</Text>

                  <View style={{ marginTop: 8 }}>
                    <Text style={styles.inputLabel}>Health facts</Text>
                    {renderHealthFacts(detailsModal.item, detailsModal.raw)}
                  </View>

                  <Text style={[styles.inputLabel, { marginTop: 12 }]}>Add to</Text>
                  <View style={{ flexDirection: 'row', marginBottom: 6 }}>
                    {(['Breakfast','Lunch','Dinner','Snack'] as MealType[]).map(mt => (
                      <TouchableOpacity
                        key={mt}
                        onPress={() => setSearchMealType(mt)}
                        style={[styles.smallChip, { backgroundColor: mt === searchMealType ? '#111827' : '#E5E7EB' }]}
                      >
                        <Text style={{ fontWeight: '700', color: mt === searchMealType ? '#FFF' : '#111827' }}>{mt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {detailsModal.item.source.type === 'perServing' ? (
                    <>
                      <Text style={styles.inputLabel}>Servings</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TextInput
                          value={servingsCount}
                          onChangeText={t => setServingsCount(onlyNum(t))}
                          placeholder="1"
                          style={[styles.input, { flex: 1 }]}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          blurOnSubmit
                          onSubmitEditing={() => Keyboard.dismiss()}
                        />
                        <View style={{ width: 8 }} />
                        <TouchableOpacity onPress={() => Keyboard.dismiss()} style={[styles.button, styles.secondaryButton]}>
                          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Done</Text>
                        </TouchableOpacity>
                      </View>
                      {isFiniteNum(detailsModal.item.source.servingSize) ? (
                        <Text style={styles.metricValue}>
                          {roundSafe(detailsModal.item.source.servingSize)}{detailsModal.item.source.servingUnit ? detailsModal.item.source.servingUnit : ''} per serving
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <Text style={styles.inputLabel}>Serving size (g)</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TextInput
                          value={servingGrams}
                          onChangeText={t => setServingGrams(onlyNum(t))}
                          placeholder="100"
                          style={[styles.input, { flex: 1 }]}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          blurOnSubmit
                          onSubmitEditing={() => Keyboard.dismiss()}
                        />
                        <View style={{ width: 8 }} />
                        <TouchableOpacity onPress={() => Keyboard.dismiss()} style={[styles.button, styles.secondaryButton]}>
                          <Text style={[styles.buttonText, styles.secondaryButtonText]}>Done</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </>
              ) : null}
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={closeDetailsModal} style={[styles.button, styles.secondaryButton]}>
                  <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmServingAndSave(searchMealType, detailsModal.item || undefined)} style={[styles.button, styles.primaryButton]}>
                  <Text style={styles.buttonText}>Add</Text>
                </TouchableOpacity>
              </View>
              </Pressable>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        {/* Water input modal */}
        <Modal visible={waterModalVisible} animationType="slide" transparent onRequestClose={closeWaterModal}>
          <View style={styles.modalRoot} pointerEvents="box-none">
            <Pressable style={styles.modalBackdrop} onPress={closeWaterModal} />
            <KeyboardAvoidingView
              behavior={Platform.select({ ios: 'padding', android: undefined })}
              style={styles.modalContainer}
              pointerEvents="box-none"
            >
              <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Add Water</Text>
              <Text style={styles.inputLabel}>Amount (oz)</Text>
              <TextInput value={waterInputOz} onChangeText={t => setWaterInputOz(onlyNum(t))} placeholder="12" style={styles.input} keyboardType="number-pad" />
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={closeWaterModal} style={[styles.button, styles.secondaryButton]}>
                  <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={submitWater} style={[styles.button, styles.primaryButton]}>
                  <Text style={styles.buttonText}>Add</Text>
                </TouchableOpacity>
              </View>
              </Pressable>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        <Modal visible={goalsModalVisible} animationType="slide" transparent onRequestClose={closeGoalsModal}>
          <View style={styles.modalRoot} pointerEvents="box-none">
            <Pressable style={styles.modalBackdrop} onPress={closeGoalsModal} />
            <KeyboardAvoidingView
              behavior={Platform.select({ ios: 'padding', android: undefined })}
              style={styles.modalContainer}
              pointerEvents="box-none"
            >
              <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>Daily Goals</Text>
              <ScrollView keyboardShouldPersistTaps="handled">
                <View style={styles.row}>
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Calories (kcal)</Text>
                    <TextInput value={goalsForm.calories} onChangeText={t => setGoalsForm(prev => ({ ...prev, calories: onlyNum(t) }))} placeholder="2200" style={styles.input} keyboardType="number-pad" />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Protein (g)</Text>
                    <TextInput value={goalsForm.protein} onChangeText={t => setGoalsForm(prev => ({ ...prev, protein: onlyNum(t) }))} placeholder="160" style={styles.input} keyboardType="number-pad" />
                  </View>
                  <View style={styles.rowSpacer} />
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Carbs (g)</Text>
                    <TextInput value={goalsForm.carbs} onChangeText={t => setGoalsForm(prev => ({ ...prev, carbs: onlyNum(t) }))} placeholder="220" style={styles.input} keyboardType="number-pad" />
                  </View>
                </View>
                <View style={styles.row}>
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Fat (g)</Text>
                    <TextInput value={goalsForm.fat} onChangeText={t => setGoalsForm(prev => ({ ...prev, fat: onlyNum(t) }))} placeholder="70" style={styles.input} keyboardType="number-pad" />
                  </View>
                  <View style={styles.rowSpacer} />
                  <View style={styles.rowItem}>
                    <Text style={styles.inputLabel}>Water (oz)</Text>
                    <TextInput value={goalsForm.waterOz} onChangeText={t => setGoalsForm(prev => ({ ...prev, waterOz: onlyNum(t) }))} placeholder="64" style={styles.input} keyboardType="number-pad" />
                  </View>
                </View>
              </ScrollView>
              <View style={styles.modalActions}>
                <TouchableOpacity onPress={closeGoalsModal} style={[styles.button, styles.secondaryButton]}>
                  <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveGoals} style={[styles.button, styles.primaryButton]}>
                  <Text style={styles.buttonText}>Save</Text>
                </TouchableOpacity>
              </View>
              </Pressable>
            </KeyboardAvoidingView>
          </View>
        </Modal>

      </View>
    </SafeAreaView>
  );
}

function computeTotals(day: DayNutrition) {
  const all: MealItem[] = ([] as MealItem[])
    .concat(day.mealsByType.Breakfast)
    .concat(day.mealsByType.Lunch)
    .concat(day.mealsByType.Dinner)
    .concat(day.mealsByType.Snack);
  let calories = 0, protein = 0, carbs = 0, fat = 0;
  for (const item of all) {
    calories += item.calories || 0;
    protein += item.protein || 0;
    carbs += item.carbs || 0;
    fat += item.fat || 0;
  }
  return { calories, protein, carbs, fat };
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const widthPct = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${widthPct}%`, backgroundColor: color }]} />
    </View>
  );
}

function MacroProgress({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  return (
    <View style={styles.macroBox}>
      <Text style={styles.macroLabel}>{label}</Text>
      <ProgressBar pct={percent(value, goal)} color={color} />
      <Text style={styles.macroValue}>{round(value)}/{goal} g</Text>
    </View>
  );
}

function renderMacroInline(item: MealItem) {
  const parts: string[] = [];
  if (item.protein != null) parts.push(`${round(item.protein)}g P`);
  if (item.carbs != null) parts.push(`${round(item.carbs)}g C`);
  if (item.fat != null) parts.push(`${round(item.fat)}g F`);
  return parts.length ? `  ·  ${parts.join(' / ')}` : '';
}

function renderSearchMacroInline(it: FdcSearchItem): string {
  const ln = it.labelNutrients;
  const kcal = isFiniteNum(ln?.calories?.value) ? `${roundSafe(ln!.calories!.value)} kcal` : '—';
  const item: MealItem = {
    id: 'tmp',
    name: it.description,
    calories: isFiniteNum(ln?.calories?.value) ? roundSafe(ln!.calories!.value) : undefined,
    protein: isFiniteNum(ln?.protein?.value) ? roundSafe(ln!.protein!.value) : undefined,
    carbs: isFiniteNum(ln?.carbohydrates?.value) ? roundSafe(ln!.carbohydrates!.value) : undefined,
    fat: isFiniteNum(ln?.fat?.value) ? roundSafe(ln!.fat!.value) : undefined,
  };
  return `${kcal}${renderMacroInline(item)}`;
}

function renderSearchSubtitle(it: FdcSearchItem): string {
  const parts: string[] = [];
  if (it.brandOwner) parts.push(it.brandOwner);
  if (isFiniteNum(it.servingSize)) parts.push(`${roundSafe(it.servingSize)}${it.servingSizeUnit || ''}`);
  if (it.dataType) parts.push(it.dataType);
  return parts.join(' · ');
}

function renderHealthFacts(item: { fdcId: number; name: string; source: ServingSource }, raw?: FdcFoodDetails | null) {
  const rows: { label: string; value: string }[] = [];
  const format = (v?: number, unit?: string) => isFiniteNum(v) ? `${roundSafe(v)}${unit || ''}` : '—';

  if (item.source.type === 'perServing') {
    rows.push({ label: 'Calories', value: format(item.source.calories, ' kcal') });
    rows.push({ label: 'Protein', value: format(item.source.protein, ' g') });
    rows.push({ label: 'Carbs', value: format(item.source.carbs, ' g') });
    rows.push({ label: 'Fat', value: format(item.source.fat, ' g') });
  } else {
    rows.push({ label: 'Calories (per 100g)', value: format(item.source.per100g.calories, ' kcal') });
    rows.push({ label: 'Protein (per 100g)', value: format(item.source.per100g.protein, ' g') });
    rows.push({ label: 'Carbs (per 100g)', value: format(item.source.per100g.carbs, ' g') });
    rows.push({ label: 'Fat (per 100g)', value: format(item.source.per100g.fat, ' g') });
  }

  // Extended nutrients if available (from labelNutrients first, else foodNutrients)
  const ext = extractExtendedNutrients(raw);
  rows.push({ label: 'Fiber', value: format(ext.fiber, ' g') });
  rows.push({ label: 'Sugars', value: format(ext.sugars, ' g') });
  rows.push({ label: 'Saturated Fat', value: format(ext.satFat, ' g') });
  rows.push({ label: 'Cholesterol', value: format(ext.cholesterol, ' mg') });
  rows.push({ label: 'Sodium', value: format(ext.sodium, ' mg') });

  return (
    <View style={{ backgroundColor: '#F9FAFB', borderRadius: 12, padding: 12 }}>
      {rows.map((r, i) => (
        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
          <Text style={{ color: '#6B7280' }}>{r.label}</Text>
          <Text style={{ color: '#111827', fontWeight: '700' }}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function extractExtendedNutrients(details?: FdcFoodDetails | null): { fiber?: number; sugars?: number; sodium?: number; cholesterol?: number; satFat?: number } {
  if (!details) return {};
  // Prefer labelNutrients if branded
  const ln: any = details.labelNutrients || {};
  const hasLN = Object.keys(ln).length > 0;
  if (hasLN) {
    return {
      fiber: isFiniteNum(ln.fiber?.value) ? ln.fiber.value : undefined,
      sugars: isFiniteNum(ln.sugars?.value) ? ln.sugars.value : undefined,
      sodium: isFiniteNum(ln.sodium?.value) ? ln.sodium.value : undefined,
      cholesterol: isFiniteNum(ln.cholesterol?.value) ? ln.cholesterol.value : undefined,
      satFat: isFiniteNum(ln.saturatedFat?.value) ? ln.saturatedFat.value : undefined,
    };
  }
  // Fallback: inspect foodNutrients by known IDs/unit
  const by = (predicate: (fn: FdcFoodNutrient) => boolean) => {
    const hit = (details.foodNutrients || []).find(predicate);
    return isFiniteNum(hit?.amount) ? hit!.amount! : undefined;
  };
  const unitIs = (fn: FdcFoodNutrient, unit: string) => (fn.nutrient?.unitName || '').toUpperCase() === unit;
  const nameInc = (fn: FdcFoodNutrient, q: string) => (fn.nutrient?.name || '').toLowerCase().includes(q);
  return {
    fiber: by(fn => unitIs(fn, 'G') && (fn.nutrient?.id === 1079 || nameInc(fn, 'fiber'))),
    sugars: by(fn => unitIs(fn, 'G') && (fn.nutrient?.id === 2000 || nameInc(fn, 'sugar'))),
    sodium: by(fn => unitIs(fn, 'MG') && (fn.nutrient?.id === 1093 || nameInc(fn, 'sodium'))),
    cholesterol: by(fn => unitIs(fn, 'MG') && (fn.nutrient?.id === 1253 || nameInc(fn, 'cholesterol'))),
    satFat: by(fn => unitIs(fn, 'G') && (fn.nutrient?.id === 1258 || nameInc(fn, 'saturated'))),
  };
}
function percent(value: number, goal: number): number {
  if (!goal || goal <= 0) return 0;
  return (value / goal) * 100;
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

function isFiniteNum(n: any): n is number { return typeof n === 'number' && Number.isFinite(n); }
function roundSafe(n: any): number { return isFiniteNum(n) ? round(n) : 0; }
function capitalize(s: string): string { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function onlyNum(t: string): string { return t.replace(/[^0-9.]/g, ''); }
function safeNum(t: string): number | undefined { const n = parseFloat(t); return Number.isNaN(n) ? undefined : n; }
function clampNum(n: number | undefined, min: number, max: number): number { const x = typeof n === 'number' && !Number.isNaN(n) ? n : min; return Math.max(min, Math.min(max, x)); }

function getTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatPrettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return new Intl.DateTimeFormat(undefined, opts).format(dt);
}

function minusOneDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function plusOneDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F7F9' },
  container: { flex: 1, backgroundColor: '#F7F7F9' },

  headerCard: {
    marginTop: 8,
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    ...platformShadow(),
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#111' },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  dateText: { fontSize: 14, fontWeight: '700', color: '#111827', marginHorizontal: 12 },
  iconButton: { padding: 6, borderRadius: 999, backgroundColor: '#EEF2F7' },

  metricLabel: { fontSize: 12, color: '#666', marginTop: 8 },
  metricValue: { fontSize: 12, color: '#333', marginTop: 6 },
  macrosRow: { flexDirection: 'row', marginTop: 12 },
  macroBox: { flex: 1, marginRight: 8 },
  macroLabel: { fontSize: 12, color: '#666' },
  macroValue: { fontSize: 12, color: '#333', marginTop: 6 },

  progressTrack: { height: 8, backgroundColor: '#E5E7EB', borderRadius: 999, overflow: 'hidden', marginTop: 6 },
  progressFill: { height: 8, borderRadius: 999 },

  section: { marginTop: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginHorizontal: 16, marginBottom: 8, color: '#111' },

  emptyStateSmall: { paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center' },
  emptySubtitle: { fontSize: 14, color: '#777' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    ...platformShadow(),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  cardMeta: { fontSize: 14, color: '#333' },
  cardNotes: { fontSize: 13, color: '#555', marginTop: 8 },
  deleteText: { color: '#EF4444', fontWeight: '700' },
  tagPill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 8, marginRight: 6, marginTop: 4 },
  tagPillText: { fontSize: 12, color: '#374151', fontWeight: '700' },

  modalRoot: { flex: 1 },
  modalBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)', zIndex: 0 },
  modalContainer: { flex: 1, justifyContent: 'flex-end', zIndex: 1 },
  modalCard: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '85%' },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, color: '#111' },
  inputLabel: { fontSize: 12, color: '#666', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#111' },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  button: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  primaryButton: { backgroundColor: '#111827' },
  secondaryButton: { backgroundColor: '#E5E7EB' },
  buttonText: { color: '#FFF', fontWeight: '700' },
  secondaryButtonText: { color: '#111827' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  rowItem: { flex: 1 },
  rowSpacer: { width: 12 },
  smallChip: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12, marginLeft: 8 },
});

function platformShadow(elevation: number = 3) {
  if (Platform.OS === 'ios') {
    return { shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 6 }, shadowRadius: 12 };
  }
  return { elevation } as any;
}

