import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, FlatList, Linking, Modal, Platform, Pressable, RefreshControl,
  ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { useCatalogue } from './src/useCatalogue';
import { usePreferences } from './src/storage';
import {
  filterVehicles, formatMileage, formatPrice, fuelCategory, FUEL_LABELS,
  whatsappUrl, vehicleShareMessage, vehicleShareUrl, WHATSAPP_NUMBER,
  type FuelCategory, type SortOrder, type Vehicle,
} from './src/catalogue';
import { Button, Chip, colors, EmptyState, Icon, IconButton, Notice, VehicleImage, type IconName } from './src/ui';

void SplashScreen.preventAutoHideAsync().catch(() => {});
const ORIGIN = 'https://autovalorpt-assistente.vercel.app';
type Tab = 'stock' | 'favorites' | 'compare' | 'contact';
const TABS: { id: Tab; label: string; icon: IconName; selectedIcon: IconName }[] = [
  { id: 'stock', label: 'Viaturas', icon: 'car-outline', selectedIcon: 'car' },
  { id: 'favorites', label: 'Favoritos', icon: 'heart-outline', selectedIcon: 'heart' },
  { id: 'compare', label: 'Comparar', icon: 'swap-horizontal-outline', selectedIcon: 'swap-horizontal' },
  { id: 'contact', label: 'Contacto', icon: 'chatbubble-ellipses-outline', selectedIcon: 'chatbubble-ellipses' },
];
const SORTS: { id: SortOrder; label: string }[] = [
  { id: 'price-asc', label: 'Preço: menor primeiro' }, { id: 'price-desc', label: 'Preço: maior primeiro' },
  { id: 'year-desc', label: 'Mais recentes' }, { id: 'mileage-asc', label: 'Menos quilómetros' },
];
const PRICES = [15000, 20000, 25000, 30000, 40000];

async function openExternal(url: string) {
  try { await Linking.openURL(url); }
  catch { Alert.alert('Não foi possível abrir', 'Tenta novamente ou telefona para +351 965 637 736.'); }
}
async function shareVehicle(vehicle: Vehicle) {
  try {
    await Share.share(Platform.OS === 'ios'
      ? { message: vehicleShareMessage(vehicle), url: vehicleShareUrl(vehicle), title: vehicle.title }
      : { message: vehicleShareMessage(vehicle), title: vehicle.title });
  } catch { Alert.alert('Partilha indisponível', 'Tenta partilhar esta viatura novamente.'); }
}
function dateLabel(value?: string | null) {
  if (!value) return 'A confirmar o stock';
  return new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' }).format(new Date(value));
}
function incomingVehicle(url: string | null | undefined): string | null {
  return typeof url === 'string' ? url.match(/^autovalorpt:\/\/viatura\/(ID[A-Za-z0-9]{5,30})$/)?.[1] ?? null : null;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  useEffect(() => { if (fontsLoaded || fontError) void SplashScreen.hideAsync(); }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return null;
  return <SafeAreaProvider><CatalogueApp /></SafeAreaProvider>;
}

function CatalogueApp() {
  const catalogue = useCatalogue();
  const preferences = usePreferences();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<Vehicle>>(null);
  const [tab, setTab] = useState<Tab>('stock');
  const [query, setQuery] = useState('');
  const [fuel, setFuel] = useState<FuelCategory | 'all'>('all');
  const [brand, setBrand] = useState('all');
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [sort, setSort] = useState<SortOrder>('price-asc');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photoVisible, setPhotoVisible] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const items = catalogue.snapshot?.items ?? [];
  const availableWidth = width - insets.left - insets.right;
  const columns = fontScale > 1.35 ? 1 : availableWidth >= 1024 ? 3 : availableWidth >= 650 ? 2 : 1;
  const contentWidth = Math.min(availableWidth, 1180);
  const cardWidth = (contentWidth - 40 - (columns - 1) * 16) / columns;
  const selected = items.find(item => item.id === selectedId);
  const favorites = useMemo(() => items.filter(item => preferences.favorites.includes(item.id)), [items, preferences.favorites]);
  const comparison = preferences.comparisonIds.map(id => items.find(item => item.id === id)).filter((item): item is Vehicle => Boolean(item));
  const brands = [...new Set(items.map(item => item.brand))].sort((a, b) => a.localeCompare(b, 'pt-PT'));
  const filtered = useMemo(() => filterVehicles(items, {
    query, fuel, brand, maxPrice, sort, favoritesOnly: tab === 'favorites', favoriteIds: preferences.favorites,
  }), [items, query, fuel, brand, maxPrice, sort, tab, preferences.favorites]);
  const hasFilters = query.length > 0 || fuel !== 'all' || brand !== 'all' || maxPrice !== null;
  const advancedFilterCount = Number(brand !== 'all') + Number(maxPrice !== null);

  useEffect(() => {
    void Linking.getInitialURL().then(url => { const id = incomingVehicle(url); if (id) setSelectedId(id); }).catch(() => {});
    const subscription = Linking.addEventListener('url', ({ url }) => { const id = incomingVehicle(url); if (id) setSelectedId(id); });
    return () => subscription.remove();
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 3500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    // Retired cars must not occupy invisible comparison slots. Only prune after
    // a confirmed live read; an offline copy must not change the selection.
    if (!catalogue.snapshot || catalogue.isStale || !preferences.isReady) return;
    const currentIds = new Set(catalogue.snapshot.items.map(item => item.id));
    for (const id of preferences.comparisonIds) if (!currentIds.has(id)) preferences.toggleComparison(id);
  }, [catalogue.snapshot, catalogue.isStale, preferences.isReady, preferences.comparisonIds, preferences.toggleComparison]);
  const resetFilters = useCallback(() => { setQuery(''); setFuel('all'); setBrand('all'); setMaxPrice(null); }, []);
  const changeTab = (next: Tab) => { listRef.current?.scrollToOffset({ offset: 0, animated: false }); setTab(next); resetFilters(); };
  const compareVehicle = (vehicle: Vehicle) => {
    if (!preferences.isReady) return;
    const wasSelected = preferences.comparisonIds.includes(vehicle.id);
    if (!preferences.toggleComparison(vehicle.id)) {
      Alert.alert('Compara até 3 viaturas', 'Retira uma viatura da comparação para adicionar outra.'); return;
    }
    setToast(wasSelected ? 'Viatura retirada da comparação' : 'Viatura adicionada à comparação');
  };
  const openVehicle = (vehicle: Vehicle) => { setPhotoVisible(false); setSelectedId(vehicle.id); };
  const closeVehicle = () => { setPhotoVisible(false); setSelectedId(null); };
  const refreshControl = <RefreshControl refreshing={catalogue.isRefreshing && !catalogue.isLoading}
    onRefresh={() => void catalogue.refresh()} tintColor={colors.navy} colors={[colors.navy]} />;

  const catalogueHeader = (<View style={[s.catalogueHeader, { maxWidth: 1180 }]}>
          <View style={s.headingRow}><View style={s.flex}><Text style={s.eyebrow}>{tab === 'favorites' ? 'A TUA SELEÇÃO' : 'ESCOLHE COM CONFIANÇA'}</Text>
            <Text accessibilityRole="header" style={s.pageTitle}>{tab === 'favorites' ? 'Os teus favoritos' : 'Encontra a tua viatura'}</Text></View>
            <View style={s.countBadge}><Text style={s.countText}>{tab === 'favorites' ? favorites.length : items.length}</Text></View></View>
          <View style={s.searchRow}>
            <View style={s.searchBox}><Icon name="search-outline" size={20} color={colors.muted} />
              <TextInput value={query} onChangeText={setQuery} placeholder="Marca, modelo ou ano" placeholderTextColor={colors.muted}
                accessibilityLabel="Pesquisar viaturas por marca, modelo ou ano" style={s.searchInput} returnKeyType="search" autoCorrect={false} />
              {!!query && <IconButton name="close" label="Limpar pesquisa" onPress={() => setQuery('')} />}</View>
            <Pressable onPress={() => setFiltersVisible(true)} style={s.filterButton} accessibilityRole="button"
              accessibilityLabel={`Filtros e ordenação${advancedFilterCount ? `, ${advancedFilterCount} filtros ativos` : ''}`}>
              <Icon name="options-outline" color={colors.white} />
              {advancedFilterCount > 0 && <View style={s.filterDot} />}
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} keyboardShouldPersistTaps="handled">
            {(['all', 'electric', 'hybrid', 'diesel', 'petrol'] as const).map(value =>
              <Chip key={value} title={FUEL_LABELS[value]} selected={fuel === value} onPress={() => setFuel(value)} />)}
          </ScrollView>
          <View style={s.resultRow}><Text style={s.resultLabel}>{filtered.length} {filtered.length === 1 ? 'viatura' : 'viaturas'}{hasFilters ? ' encontradas' : ' em stock'}</Text>
            <Pressable onPress={() => void catalogue.refresh()} accessibilityRole="button" accessibilityLabel="Atualizar stock" style={s.refreshButton}>
              <Icon name="refresh-outline" size={15} color={colors.muted} /><Text style={s.updatedLabel}>{catalogue.isRefreshing ? 'A atualizar…' : dateLabel(catalogue.snapshot?.updatedAt)}</Text>
            </Pressable></View>
        </View>);

  return <View style={s.root}>
    <StatusBar style="light" />
    <View style={{ backgroundColor: colors.navy }}><SafeAreaView edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <View style={s.brandIcon}><Text style={s.brandLetters}>AV</Text><View style={s.brandUnderline} /></View>
        <View style={s.headerText}><Text style={s.brandName}>AutoValor<Text style={{ color: colors.gold }}>PT</Text></Text>
          <Text style={s.brandSubtitle}>O teu próximo automóvel</Text></View>
        <IconButton name="call-outline" label="Telefonar para a AutoValorPT" light onPress={() => void openExternal(`tel:+${WHATSAPP_NUMBER}`)} />
      </View>
    </SafeAreaView></View>
    <SafeAreaView edges={['left', 'right']} style={s.main}>
      {(tab === 'stock' || tab === 'favorites') && <>
        <FlatList ref={listRef} key={`catalogue-${columns}`} data={filtered} numColumns={columns} keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" refreshControl={refreshControl}
          style={s.list} contentContainerStyle={[s.listContent, { maxWidth: 1180, width: '100%', alignSelf: 'center' }]}
          columnWrapperStyle={columns > 1 ? s.cardRow : undefined}
          ListHeaderComponent={<View style={s.notices}>
            {catalogueHeader}
            {catalogue.error && <Notice warning message={catalogue.snapshot ? `${catalogue.error} A mostrar o último stock guardado.` : catalogue.error} />}
            {!catalogue.error && catalogue.isStale && <Notice warning message="O stock precisa de confirmação. Atualiza a lista e confirma a disponibilidade connosco." />}
            {preferences.storageError && <Notice warning message={preferences.storageError} />}
            {(brand !== 'all' || maxPrice !== null) && <View style={s.activeFilters}>
              {brand !== 'all' && <Chip title={`${brand} ×`} selected onPress={() => setBrand('all')} />}
              {maxPrice !== null && <Chip title={`Até ${formatPrice(maxPrice)} ×`} selected onPress={() => setMaxPrice(null)} />}
            </View>}
          </View>}
          renderItem={({ item }) => <VehicleCard vehicle={item} width={cardWidth} favorite={preferences.favorites.includes(item.id)}
            comparing={preferences.comparisonIds.includes(item.id)} preferencesReady={preferences.isReady}
            onOpen={() => openVehicle(item)} onFavorite={() => preferences.toggleFavorite(item.id)} onCompare={() => compareVehicle(item)} />}
          ListEmptyComponent={<EmptyState loading={catalogue.isLoading}
            icon={tab === 'favorites' ? 'heart-outline' : 'search-outline'}
            title={catalogue.isLoading ? 'A carregar as viaturas' : !catalogue.snapshot ? 'Não foi possível abrir o catálogo' : tab === 'favorites' && !favorites.length ? 'Guarda as tuas preferidas' : 'Sem viaturas para mostrar'}
            message={catalogue.isLoading ? 'Estamos a consultar o stock da AutoValorPT.' : !catalogue.snapshot ? 'Verifica a ligação à Internet e tenta novamente.' : tab === 'favorites' && !favorites.length ? 'Toca no coração de uma viatura para a encontrares aqui. A tua seleção fica guardada neste dispositivo.' : hasFilters ? 'Experimenta outra pesquisa ou ajusta os filtros.' : 'Volta em breve para consultar as novas entradas.'}
            action={!catalogue.snapshot && !catalogue.isLoading ? 'Tentar novamente' : hasFilters ? 'Limpar filtros' : tab === 'favorites' ? 'Explorar viaturas' : undefined}
            onAction={!catalogue.snapshot ? () => void catalogue.refresh() : hasFilters ? resetFilters : () => changeTab('stock')} />}
          ListFooterComponent={filtered.length > 0 ? <Text style={s.listFooter}>Disponibilidade sujeita a confirmação.{tab === 'favorites' ? '\nSó aparecem favoritos que continuam no stock atual.' : '\nDesliza para baixo para atualizar.'}</Text> : undefined}
        />
      </>}
      {tab === 'compare' && <ScrollView refreshControl={refreshControl} contentContainerStyle={s.pageContent}>
        <Text style={s.eyebrow}>LADO A LADO</Text><Text accessibilityRole="header" style={s.pageTitle}>Compara com calma</Text>
        <Text style={s.lead}>Escolhe até 3 viaturas e compara os dados que interessam.</Text>
        {catalogue.isStale && <Notice warning message="A mostrar stock guardado. Confirma a disponibilidade das viaturas." />}
        {comparison.length === 0 ? <><EmptyState icon="swap-horizontal-outline" title="Qual é a melhor para ti?"
          message="Adiciona viaturas à comparação através do símbolo de duas setas em cada cartão."
          action="Escolher viaturas" onAction={() => changeTab('stock')} />
          {preferences.comparisonIds.length > 0 && <Button title="Limpar seleção guardada" variant="secondary" onPress={() => preferences.clearComparison()} />}</> : <>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={s.compareScroller}>
            {comparison.map(item => <View key={item.id} style={[s.comparisonCard, { width: Math.max(235, Math.min(300, contentWidth - 65)) }]}>
              <VehicleImage uri={item.image} title={item.title} />
              <View style={s.compareBody}><View style={s.compareTitleRow}><Text style={s.compareBrand}>{item.brand.toUpperCase()}</Text>
                <IconButton name="close" label={`Retirar ${item.title} da comparação`} onPress={() => preferences.toggleComparison(item.id)} /></View>
                <Text style={s.compareTitle} numberOfLines={3}>{item.title}</Text>
                <CompareRow label="Preço" value={formatPrice(item.price)} strong />
                <CompareRow label="Ano" value={item.year?.toString() ?? 'Por confirmar'} />
                <CompareRow label="Quilómetros" value={formatMileage(item.mileage)} />
                <CompareRow label="Combustível" value={item.fuel || 'Por confirmar'} />
                <Button title="Ver viatura" onPress={() => openVehicle(item)} />
              </View>
            </View>)}
          </ScrollView>
          <Button title="Escolher mais viaturas" icon="add" variant="secondary" onPress={() => changeTab('stock')} />
          <Button title="Limpar comparação" variant="secondary" onPress={() => preferences.clearComparison()} />
        </>}
      </ScrollView>}
      {tab === 'contact' && <ScrollView contentContainerStyle={[s.pageContent, { maxWidth: 700 }]}>
        <Text style={s.eyebrow}>ESTAMOS POR PERTO</Text><Text accessibilityRole="header" style={s.pageTitle}>Fala connosco</Text>
        <Text style={s.lead}>Encontraste uma viatura? Ajudamos-te a esclarecer os detalhes e a combinar uma visita.</Text>
        <View style={s.contactCard}><View style={s.contactAvatar}><Icon name="chatbubbles-outline" size={34} color={colors.gold} /></View>
          <Text style={s.contactName}>AutoValorPT</Text><Text style={s.contactNumber}>+351 965 637 736</Text>
          <Button title="Conversar no WhatsApp" icon="logo-whatsapp" variant="whatsapp" onPress={() => void openExternal(whatsappUrl())} />
          <Button title="Telefonar" icon="call-outline" variant="secondary" onPress={() => void openExternal(`tel:+${WHATSAPP_NUMBER}`)} />
        </View>
        <View style={s.infoCard}><Icon name="shield-checkmark-outline" size={26} color={colors.green} /><View style={s.flex}>
          <Text style={s.infoTitle}>A tua seleção, no teu dispositivo</Text><Text style={s.infoCopy}>Podes consultar o catálogo, guardar favoritos e comparar viaturas sem criar uma conta.</Text></View></View>
        <View style={s.infoCard}><Icon name="sync-outline" size={26} color={colors.green} /><View style={s.flex}>
          <Text style={s.infoTitle}>Stock atualizado</Text><Text style={s.infoCopy}>A app consulta o stock ao abrir e enquanto a utilizas. Última atualização do stock: {dateLabel(catalogue.snapshot?.updatedAt)}.</Text></View></View>
        <Button title="Privacidade" icon="lock-closed-outline" variant="secondary" onPress={() => void openExternal(`${ORIGIN}/app/privacidade.html`)} />
        <Button title="Ajuda e suporte" icon="help-circle-outline" variant="secondary" onPress={() => void openExternal(`${ORIGIN}/app/apoio.html`)} />
        <Text style={s.listFooter}>AutoValorPT · Versão {Constants.expoConfig?.version ?? '1.0.0'}{`\n`}Preços e disponibilidade sujeitos a confirmação.</Text>
      </ScrollView>}
    </SafeAreaView>
    {toast && <View pointerEvents="none" accessibilityLiveRegion="polite" style={[s.toast, { bottom: Math.max(insets.bottom, 12) + 70 }]}><Text style={s.toastText}>{toast}</Text></View>}
    <View style={[s.tabBar, { paddingBottom: Math.max(insets.bottom, 10), paddingLeft: Math.max(insets.left, 8), paddingRight: Math.max(insets.right, 8) }]}>
      {TABS.map(item => { const active = tab === item.id; const count = item.id === 'favorites' ? favorites.length : item.id === 'compare' ? comparison.length : 0;
        return <Pressable key={item.id} onPress={() => changeTab(item.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}
          accessibilityLabel={`${item.label}${count ? `, ${count} viaturas` : ''}`} style={[s.tabItem, active && s.tabItemActive]}>
          <View><Icon name={active ? item.selectedIcon : item.icon} size={23} color={active ? colors.navy : colors.muted} />
            {count > 0 && <View style={s.tabBadge}><Text style={s.tabBadgeText}>{count}</Text></View>}</View>
          <Text style={[s.tabLabel, active && s.tabLabelActive]}>{item.label}</Text>
        </Pressable>; })}
    </View>

    <Modal visible={filtersVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setFiltersVisible(false)}>
      <SafeAreaProvider><SafeAreaView style={s.modalRoot} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="dark" />
        <View style={s.modalHeader}><Text accessibilityRole="header" style={s.modalTitle}>Encontra a combinação certa</Text><IconButton name="close" label="Fechar filtros" onPress={() => setFiltersVisible(false)} /></View>
        <ScrollView contentContainerStyle={s.filterContent}>
          <Text style={s.sectionTitle}>Marca</Text><View style={s.wrap}><Chip title="Todas" selected={brand === 'all'} onPress={() => setBrand('all')} />
            {brands.map(value => <Chip key={value} title={value} selected={brand === value} onPress={() => setBrand(value)} />)}</View>
          <Text style={s.sectionTitle}>Preço até</Text><View style={s.wrap}><Chip title="Sem limite" selected={maxPrice === null} onPress={() => setMaxPrice(null)} />
            {PRICES.map(value => <Chip key={value} title={formatPrice(value)} selected={maxPrice === value} onPress={() => setMaxPrice(value)} />)}</View>
          <Text style={s.sectionTitle}>Ordenar por</Text><View style={s.sortOptions}>{SORTS.map(value =>
            <Pressable key={value.id} onPress={() => setSort(value.id)} accessibilityRole="radio" accessibilityState={{ checked: sort === value.id }} style={s.sortOption}>
              <Text style={s.sortLabel}>{value.label}</Text><Icon name={sort === value.id ? 'radio-button-on' : 'radio-button-off'} color={sort === value.id ? colors.navy : colors.muted} />
            </Pressable>)}</View>
          <Button title="Limpar filtros" variant="secondary" onPress={resetFilters} />
        </ScrollView>
        <View style={s.modalFooter}><Button title={`Mostrar ${filtered.length} ${filtered.length === 1 ? 'viatura' : 'viaturas'}`} onPress={() => setFiltersVisible(false)} /></View>
      </SafeAreaView></SafeAreaProvider>
    </Modal>

    <Modal visible={selectedId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeVehicle}>
      <SafeAreaProvider><SafeAreaView style={s.modalRoot} edges={['top', 'bottom', 'left', 'right']}>
        <StatusBar style="dark" />
        <View style={s.modalHeader}><Text style={s.modalTitle}>A tua próxima viatura</Text><View style={s.inlineActions}>
          {selected && <IconButton name={preferences.favorites.includes(selected.id) ? 'heart' : 'heart-outline'}
            selected={preferences.favorites.includes(selected.id)} disabled={!preferences.isReady}
            label={preferences.favorites.includes(selected.id) ? 'Retirar dos favoritos' : 'Guardar nos favoritos'} onPress={() => preferences.toggleFavorite(selected.id)} />}
          <IconButton name="close" label="Fechar viatura" onPress={closeVehicle} /></View></View>
        {selected ? <>
          <ScrollView contentContainerStyle={s.detailContent}>
            <Pressable onPress={() => setPhotoVisible(true)} accessibilityRole="button" accessibilityLabel={`Ampliar fotografia de ${selected.title}`}>
              <VehicleImage uri={selected.image} title={selected.title} style={s.detailPhoto} />
              <View style={s.expandPhoto}><Icon name="expand-outline" size={18} color={colors.white} /></View>
            </Pressable>
            <View style={s.detailBody}>
              <View style={s.detailBrandRow}><Text style={s.eyebrow}>{selected.brand.toUpperCase()}</Text><Text style={s.fuelText}>{selected.fuel || 'Combustível por confirmar'}</Text></View>
              <Text accessibilityRole="header" style={s.detailTitle}>{selected.title}</Text><Text style={s.detailPrice}>{formatPrice(selected.price)}</Text>
              {catalogue.isStale && <Notice warning message="Estes dados estão guardados no dispositivo. Confirma o preço e a disponibilidade connosco." />}
              <View style={s.specsGrid}>
                <Spec icon="calendar-outline" label="Ano" value={selected.year?.toString() ?? 'Por confirmar'} />
                <Spec icon="speedometer-outline" label="Quilómetros" value={formatMileage(selected.mileage)} />
                <Spec icon="flash-outline" label="Combustível" value={selected.fuel || 'Por confirmar'} />
                <Spec icon="car-sport-outline" label="Marca" value={selected.brand} />
              </View>
              <View style={s.wrap}><Button title="Partilhar" icon="share-outline" variant="secondary" onPress={() => void shareVehicle(selected)} style={s.flex} />
                <Button title={preferences.comparisonIds.includes(selected.id) ? 'Na comparação' : 'Comparar'} icon="swap-horizontal-outline" variant="secondary"
                  disabled={!preferences.isReady} onPress={() => compareVehicle(selected)} style={s.flex} /></View>
              <Button title="Ver todas as fotografias no anúncio" icon="open-outline" variant="secondary" onPress={() => void openExternal(selected.url)} />
              <Text style={s.detailNote}>Fotografia original do anúncio. Disponibilidade e dados sujeitos a confirmação.</Text>
            </View>
          </ScrollView>
          <View style={s.modalFooter}><Button title="Pedir informações" icon="logo-whatsapp" variant="whatsapp" onPress={() => void openExternal(whatsappUrl(selected))} />
            <Text style={s.whatsappHint}>Abre o WhatsApp com a viatura selecionada.</Text></View>
        </> : <EmptyState loading={catalogue.isLoading} title={catalogue.isLoading ? 'A consultar a viatura' : 'Viatura indisponível'}
          message={catalogue.isLoading ? 'Estamos a atualizar o catálogo.' : 'Esta viatura já não consta do stock disponível ou não foi possível confirmar os seus dados.'}
          action="Voltar ao catálogo" onAction={closeVehicle} />}
        {toast && <View pointerEvents="none" accessibilityLiveRegion="polite" style={[s.toast, { bottom: 125 }]}><Text style={s.toastText}>{toast}</Text></View>}
        <Modal visible={photoVisible && Boolean(selected)} animationType="fade" onRequestClose={() => setPhotoVisible(false)}>
          <SafeAreaProvider><SafeAreaView style={s.photoViewer}><StatusBar style="light" /><View style={s.photoViewerHeader}>
            <Text style={s.photoViewerTitle}>Fotografia original</Text><IconButton name="close" label="Fechar fotografia" light onPress={() => setPhotoVisible(false)} /></View>
            <ScrollView maximumZoomScale={3} minimumZoomScale={1} centerContent contentContainerStyle={s.photoScroll}>
              {selected && <VehicleImage uri={selected.image} title={selected.title} style={{ height: Math.max(240, width * 0.9), aspectRatio: undefined, backgroundColor: colors.navy }} />}
            </ScrollView><Text style={s.photoCaption}>{selected?.title}</Text>
          </SafeAreaView></SafeAreaProvider>
        </Modal>
      </SafeAreaView></SafeAreaProvider>
    </Modal>
  </View>;
}

function VehicleCard({ vehicle, width, favorite, comparing, preferencesReady, onOpen, onFavorite, onCompare }: {
  vehicle: Vehicle; width: number; favorite: boolean; comparing: boolean; preferencesReady: boolean; onOpen: () => void; onFavorite: () => void; onCompare: () => void;
}) {
  const category = fuelCategory(vehicle.fuel);
  return <View style={[s.card, { width }]}>
    <View><Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Ver ${vehicle.title}`}><VehicleImage uri={vehicle.image} title={vehicle.title} /></Pressable>
      <View style={s.cardFuel}><Text style={s.cardFuelText}>{category === 'electric' ? 'Elétrico' : category === 'hybrid' ? 'Híbrido' : vehicle.fuel || 'Viatura'}</Text></View>
      <View style={s.cardFavorite}><IconButton name={favorite ? 'heart' : 'heart-outline'} selected={favorite} disabled={!preferencesReady}
        label={`${favorite ? 'Retirar' : 'Guardar'} ${vehicle.title} ${favorite ? 'dos' : 'nos'} favoritos`} onPress={onFavorite} /></View>
    </View>
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${vehicle.title}, ${formatPrice(vehicle.price)}, ver detalhes`} style={s.cardMain}>
      <Text style={s.cardBrand}>{vehicle.brand.toUpperCase()}</Text><Text style={s.cardTitle} numberOfLines={2}>{vehicle.title}</Text>
      <View style={s.cardSpecs}><View style={s.smallSpec}><Icon name="calendar-outline" size={15} color={colors.muted} /><Text style={s.cardSpecText}>{vehicle.year ?? 'Ano a confirmar'}</Text></View>
        <View style={s.smallSpec}><Icon name="speedometer-outline" size={15} color={colors.muted} /><Text style={s.cardSpecText}>{formatMileage(vehicle.mileage)}</Text></View></View>
      <View style={s.cardBottom}><Text style={s.cardPrice}>{formatPrice(vehicle.price)}</Text><Icon name="arrow-forward" size={22} color={colors.amber} /></View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{ selected: comparing, disabled: !preferencesReady }}
      accessibilityLabel={`${comparing ? 'Retirar' : 'Adicionar'} ${vehicle.title} ${comparing ? 'da' : 'à'} comparação`}
      disabled={!preferencesReady} onPress={onCompare} style={[s.compareButton, comparing && s.compareButtonActive]}>
      <Icon name={comparing ? 'checkmark-circle-outline' : 'swap-horizontal-outline'} size={17} color={comparing ? colors.green : colors.muted} />
      <Text style={[s.compareButtonText, comparing && { color: colors.green }]}>{comparing ? 'Na comparação' : 'Comparar viatura'}</Text>
    </Pressable>
  </View>;
}
function CompareRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <View style={s.compareRow}><Text style={s.compareRowLabel}>{label}</Text><Text style={[s.compareRowValue, strong && s.comparePrice]}>{value}</Text></View>;
}
function Spec({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return <View style={s.spec}><Icon name={icon} color={colors.muted} size={21} /><Text style={s.specLabel}>{label}</Text><Text style={s.specValue}>{value}</Text></View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper }, flex: { flex: 1 }, main: { flex: 1 },
  header: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIcon: { width: 42, height: 42, backgroundColor: colors.navyLight, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  brandLetters: { color: colors.white, fontSize: 20, fontWeight: '900', letterSpacing: -2 }, brandUnderline: { width: 24, height: 2, borderRadius: 2, backgroundColor: colors.gold, marginTop: 2 },
  headerText: { flex: 1 }, brandName: { color: colors.white, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  brandSubtitle: { fontSize: 11, marginTop: 3, color: '#B8C8D1' },
  catalogueHeader: { paddingHorizontal: 0, paddingTop: 19, alignSelf: 'center', width: '100%' },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 17 },
  eyebrow: { fontSize: 10, lineHeight: 16, letterSpacing: 1.7, fontWeight: '700', color: colors.muted },
  pageTitle: { fontSize: 25, lineHeight: 32, letterSpacing: -0.7, color: colors.ink, fontWeight: '800' },
  countBadge: { minWidth: 36, minHeight: 36, padding: 8, borderRadius: 12, backgroundColor: '#E9EEE9', alignItems: 'center', justifyContent: 'center' }, countText: { color: colors.green, fontWeight: '700', fontSize: 15 },
  searchRow: { flexDirection: 'row', gap: 10 }, searchBox: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 14, paddingRight: 3, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: colors.white },
  searchInput: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, paddingVertical: 12 },
  filterButton: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.navy }, filterDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold, position: 'absolute', top: 8, right: 8 },
  chips: { gap: 8, paddingVertical: 12 }, resultRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 5, paddingBottom: 8 },
  resultLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' }, refreshButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4 }, updatedLabel: { color: colors.muted, fontSize: 11 },
  list: { flex: 1 }, listContent: { paddingHorizontal: 20, paddingBottom: 20, gap: 16 }, cardRow: { gap: 16, alignItems: 'stretch' }, notices: { gap: 10 }, activeFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  cardFuel: { position: 'absolute', left: 12, top: 12, backgroundColor: '#FFFFFFF0', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 9, maxWidth: '70%' }, cardFuelText: { fontSize: 11, fontWeight: '700', color: colors.green },
  cardFavorite: { position: 'absolute', top: 8, right: 8 }, cardMain: { flex: 1, padding: 17 }, cardBrand: { fontSize: 10, lineHeight: 14, letterSpacing: 1.8, fontWeight: '700', color: colors.muted },
  cardTitle: { fontSize: 19, lineHeight: 25, minHeight: 50, fontWeight: '700', letterSpacing: -0.5, color: colors.ink, marginTop: 6 },
  cardSpecs: { flexDirection: 'row', flexWrap: 'wrap', gap: 13, marginTop: 11, marginBottom: 17 }, smallSpec: { flexDirection: 'row', alignItems: 'center', gap: 5 }, cardSpecText: { fontSize: 12, color: colors.muted },
  cardBottom: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'auto' }, cardPrice: { fontSize: 26, fontWeight: '800', color: colors.ink, letterSpacing: -0.8, flexShrink: 1 },
  compareButton: { minHeight: 44, borderTopWidth: 1, borderTopColor: '#EAF0EE', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 10 }, compareButtonActive: { backgroundColor: colors.greenLight }, compareButtonText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  listFooter: { fontSize: 12, color: colors.muted, lineHeight: 20, textAlign: 'center', paddingVertical: 14 },
  pageContent: { width: '100%', maxWidth: 1180, alignSelf: 'center', padding: 22, paddingBottom: 32, gap: 14 }, lead: { color: colors.muted, fontSize: 16, lineHeight: 24, maxWidth: 590, marginBottom: 6 },
  compareScroller: { gap: 14, paddingBottom: 16 }, comparisonCard: { backgroundColor: colors.white, borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }, compareBody: { padding: 16 },
  compareTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, compareBrand: { fontSize: 10, color: colors.muted, letterSpacing: 1.4, fontWeight: '700' }, compareTitle: { fontSize: 19, lineHeight: 25, minHeight: 75, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  compareRow: { minHeight: 78, borderTopColor: colors.line, borderTopWidth: 1, paddingVertical: 13, gap: 6 }, compareRowLabel: { fontSize: 12, color: colors.muted }, compareRowValue: { fontSize: 16, lineHeight: 22, color: colors.ink, fontWeight: '600' }, comparePrice: { fontSize: 25, fontWeight: '800', lineHeight: 30 },
  contactCard: { padding: 24, gap: 14, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line }, contactAvatar: { width: 70, height: 70, borderRadius: 24, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  contactName: { color: colors.ink, fontSize: 24, fontWeight: '800', textAlign: 'center' }, contactNumber: { color: colors.muted, fontSize: 17, textAlign: 'center', marginBottom: 7 }, infoCard: { flexDirection: 'row', gap: 13, paddingVertical: 12 }, infoTitle: { color: colors.ink, fontSize: 15, fontWeight: '700', marginBottom: 5 }, infoCopy: { color: colors.muted, fontSize: 14, lineHeight: 22 },
  tabBar: { backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 8, flexDirection: 'row', gap: 4 }, tabItem: { flex: 1, minHeight: 54, borderRadius: 13, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, gap: 4 }, tabItemActive: { backgroundColor: '#F0F0E9' }, tabLabel: { fontSize: 10, color: colors.muted, fontWeight: '600' }, tabLabelActive: { color: colors.navy, fontWeight: '800' }, tabBadge: { position: 'absolute', right: -10, top: -5, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: colors.gold, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, tabBadgeText: { fontSize: 9, fontWeight: '800', color: colors.navy },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: colors.navy, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, maxWidth: '90%', zIndex: 5 }, toastText: { color: colors.white, fontSize: 13, textAlign: 'center' },
  modalRoot: { flex: 1, backgroundColor: colors.paper }, modalHeader: { paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white }, modalTitle: { flex: 1, fontSize: 17, lineHeight: 23, fontWeight: '700', color: colors.ink }, inlineActions: { flexDirection: 'row', gap: 5 }, modalFooter: { padding: 18, gap: 7, backgroundColor: colors.white, borderTopWidth: 1, borderTopColor: colors.line },
  filterContent: { padding: 22, gap: 15 }, sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '700', marginTop: 5 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, sortOptions: { backgroundColor: colors.white, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 12 }, sortOption: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, gap: 12 }, sortLabel: { fontSize: 15, color: colors.ink, flex: 1 },
  detailContent: { width: '100%', maxWidth: 850, alignSelf: 'center', paddingBottom: 14 }, detailPhoto: { aspectRatio: 1.35 }, expandPhoto: { position: 'absolute', right: 14, bottom: 14, backgroundColor: '#0B2030CC', padding: 9, borderRadius: 11 }, detailBody: { padding: 22, gap: 17 }, detailBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }, fuelText: { color: colors.green, fontSize: 12, fontWeight: '600' }, detailTitle: { fontSize: 28, lineHeight: 35, fontWeight: '800', color: colors.ink, letterSpacing: -0.7 }, detailPrice: { fontSize: 36, lineHeight: 44, fontWeight: '800', color: colors.ink, letterSpacing: -1 },
  specsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, spec: { flexGrow: 1, flexBasis: '44%', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 15, gap: 7 }, specLabel: { color: colors.muted, fontSize: 12 }, specValue: { color: colors.ink, fontSize: 16, lineHeight: 23, fontWeight: '700' }, detailNote: { color: colors.muted, fontSize: 12, lineHeight: 19 }, whatsappHint: { color: colors.muted, fontSize: 11, textAlign: 'center' },
  photoViewer: { flex: 1, backgroundColor: colors.navy }, photoViewerHeader: { padding: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, photoViewerTitle: { color: colors.white, fontSize: 16, fontWeight: '600' }, photoScroll: { flexGrow: 1, justifyContent: 'center' }, photoCaption: { color: colors.white, textAlign: 'center', fontSize: 15, lineHeight: 23, padding: 24 },
});
