import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { Vehicle } from './catalogue';
import { colors, Icon, IconButton, VehicleImage } from './ui';

/** The card keeps its cover; the detail and full-screen view share a gallery. */
export function VehicleGallery({ vehicle }: { vehicle: Vehicle }) {
  const [selectedUri, setSelectedUri] = useState(vehicle.images[0]);
  const [viewerVisible, setViewerVisible] = useState(false);
  useEffect(() => {
    if (!vehicle.images.includes(selectedUri)) setSelectedUri(vehicle.images[0]);
  }, [vehicle.images, selectedUri]);
  // Preserve the selected photograph across stock refreshes. If it was removed,
  // return to the first photo instead of retaining an out-of-range page number.
  const index = Math.max(0, vehicle.images.indexOf(selectedUri));
  const select = (next: number) => setSelectedUri(vehicle.images[next]);
  return <View>
    <PhotoPager images={vehicle.images} title={vehicle.title} index={index}
      onSelect={select} onOpen={() => setViewerVisible(true)} />
    <Modal visible={viewerVisible} animationType="fade" onRequestClose={() => setViewerVisible(false)}>
      <SafeAreaProvider><SafeAreaView style={s.viewer}>
        <StatusBar style="light" />
        <View style={s.viewerHeader}>
          <Text accessibilityRole="header" style={s.viewerHeading}>Fotografias originais</Text>
          <IconButton name="close" label="Fechar fotografias" light onPress={() => setViewerVisible(false)} />
        </View>
        {viewerVisible && <PhotoPager images={vehicle.images} title={vehicle.title} index={index}
          onSelect={select} fullScreen />}
        <Text style={s.caption} numberOfLines={2}>{vehicle.title}</Text>
      </SafeAreaView></SafeAreaProvider>
    </Modal>
  </View>;
}

function PhotoPager({ images, title, index, onSelect, onOpen, fullScreen = false }: {
  images: string[]; title: string; index: number; onSelect: (index: number) => void;
  onOpen?: () => void; fullScreen?: boolean;
}) {
  const list = useRef<FlatList<string>>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [zoomed, setZoomed] = useState(false);
  const [buttonZoom, setButtonZoom] = useState(1);
  const [zoomVersion, setZoomVersion] = useState(0);
  const activeUri = images[index];

  useEffect(() => {
    setZoomed(false); setButtonZoom(1); setZoomVersion(value => value + 1);
    if (viewport.width > 0) list.current?.scrollToOffset({ offset: index * viewport.width, animated: false });
  }, [index, activeUri, viewport.width, viewport.height]);

  const move = (next: number) => {
    if (next < 0 || next >= images.length) return;
    onSelect(next);
  };
  const pageChanged = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!viewport.width) return;
    move(Math.round(event.nativeEvent.contentOffset.x / viewport.width));
  };
  const toggleZoom = () => {
    if (zoomed) {
      setButtonZoom(1); setZoomed(false); setZoomVersion(value => value + 1);
    } else {
      setButtonZoom(2); setZoomed(true);
    }
  };
  const label = `Fotografia ${index + 1} de ${images.length}`;

  return <View style={fullScreen ? s.fullPager : s.detailPager}>
    <View style={fullScreen ? s.fullViewport : s.detailViewport}
      onLayout={({ nativeEvent: { layout } }) => {
        const width = layout.width;
        const height = layout.height;
        setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
      }}>
      {viewport.width > 0 && viewport.height > 0 && <FlatList
        key={`${viewport.width}:${viewport.height}`} ref={list} data={images}
        keyExtractor={uri => uri} horizontal pagingEnabled bounces={false}
        scrollEnabled={!zoomed} showsHorizontalScrollIndicator={false}
        initialScrollIndex={index} initialNumToRender={1} maxToRenderPerBatch={3} windowSize={3}
        removeClippedSubviews={false} extraData={`${index}:${buttonZoom}:${zoomVersion}`}
        getItemLayout={(_, itemIndex) => ({ length: viewport.width, offset: viewport.width * itemIndex, index: itemIndex })}
        onMomentumScrollEnd={pageChanged} nestedScrollEnabled
        renderItem={({ item: uri, index: photoIndex }) => {
          const photoLabel = `${title}, fotografia ${photoIndex + 1} de ${images.length}`;
          const active = photoIndex === index;
          return <View style={{ width: viewport.width, height: viewport.height }}
            accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}>
            {fullScreen ? <ZoomablePhoto key={`${uri}:${zoomVersion}`} uri={uri} title={photoLabel}
              width={viewport.width} height={viewport.height} scale={active ? buttonZoom : 1}
              onZoomChange={active ? setZoomed : undefined} /> :
              <Pressable onPress={onOpen} style={s.photoButton} accessibilityRole="button"
                accessibilityLabel={`Ampliar ${photoLabel}`} accessibilityHint="Abre a fotografia em ecrã inteiro.">
                <VehicleImage uri={uri} title={photoLabel} style={s.photo} />
                <View pointerEvents="none" style={s.expandIcon}><Icon name="expand-outline" size={18} color={colors.white} /></View>
              </Pressable>}
          </View>;
        }} />}
    </View>
    <View style={[s.controls, fullScreen && s.controlsDark]}>
      {images.length > 1 && <IconButton name="chevron-back" label="Fotografia anterior"
        light={fullScreen} disabled={index === 0} onPress={() => move(index - 1)} />}
      <Text accessibilityLabel={label} accessibilityLiveRegion="polite"
        style={[s.counter, fullScreen && s.counterLight]}>{index + 1} / {images.length}</Text>
      {images.length > 1 && <IconButton name="chevron-forward" label="Fotografia seguinte"
        light={fullScreen} disabled={index === images.length - 1} onPress={() => move(index + 1)} />}
      {fullScreen && <IconButton name={zoomed ? 'contract-outline' : 'search-outline'}
        label={zoomed ? 'Repor tamanho da fotografia' : 'Ampliar fotografia'} light onPress={toggleZoom} />}
      {!fullScreen && <IconButton name="expand-outline" label="Abrir fotografias em ecrã inteiro" onPress={() => onOpen?.()} />}
    </View>
  </View>;
}

function ZoomablePhoto({ uri, title, width, height, scale, onZoomChange }: {
  uri: string; title: string; width: number; height: number; scale: number;
  onZoomChange?: (zoomed: boolean) => void;
}) {
  if (Platform.OS === 'ios') {
    return <ScrollView style={s.photoButton} contentContainerStyle={{ width, height }}
      maximumZoomScale={3} minimumZoomScale={1} zoomScale={scale} pinchGestureEnabled
      centerContent bounces={false} bouncesZoom={false} showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false} scrollEventThrottle={32}
      onScroll={event => onZoomChange?.((event.nativeEvent.zoomScale ?? 1) > 1.01)}>
      <VehicleImage uri={uri} title={title} style={{ width, height, aspectRatio: undefined, backgroundColor: colors.navy }} />
    </ScrollView>;
  }
  // Android does not implement ScrollView's native pinch zoom. The accessible
  // enlarge control provides a pannable view without adding a gesture library.
  if (scale > 1) {
    return <ScrollView horizontal nestedScrollEnabled style={s.photoButton} bounces={false}>
      <ScrollView nestedScrollEnabled style={{ width: width * scale, height }} bounces={false}>
        <VehicleImage uri={uri} title={title} style={{ width: width * scale, height: height * scale,
          aspectRatio: undefined, backgroundColor: colors.navy }} />
      </ScrollView>
    </ScrollView>;
  }
  return <VehicleImage uri={uri} title={title} style={{ width, height, aspectRatio: undefined, backgroundColor: colors.navy }} />;
}

const s = StyleSheet.create({
  detailPager: { backgroundColor: '#EAF0EE' }, detailViewport: { width: '100%', aspectRatio: 1.35 },
  fullPager: { flex: 1, minHeight: 0 }, fullViewport: { flex: 1, minHeight: 0 },
  photoButton: { flex: 1 }, photo: { width: '100%', height: '100%', aspectRatio: undefined },
  expandIcon: { position: 'absolute', right: 14, bottom: 14, backgroundColor: '#0B2030CC', padding: 9, borderRadius: 11 },
  controls: { minHeight: 56, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 6, backgroundColor: colors.white },
  controlsDark: { backgroundColor: colors.navy },
  counter: { minWidth: 66, textAlign: 'center', color: colors.muted, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  counterLight: { color: colors.white },
  viewer: { flex: 1, backgroundColor: colors.navy },
  viewerHeader: { paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  viewerHeading: { flex: 1, color: colors.white, fontSize: 16, fontWeight: '600' },
  caption: { color: colors.white, textAlign: 'center', fontSize: 14, lineHeight: 20, paddingHorizontal: 24, paddingBottom: 16 },
});
