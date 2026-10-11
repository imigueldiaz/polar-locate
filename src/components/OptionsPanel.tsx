import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { t } from '../i18n';
import type { LensInfo } from '../../modules/polar-camera';
import { formatShutter, isoStops, shutterStops } from '../lib/stops';
import type { Prefs } from '../lib/prefs';
import { theme } from '../theme';

type Props = {
  visible: boolean;
  prefs: Prefs;
  lenses: LensInfo[];
  onChange: (patch: Partial<Prefs>) => void;
  onShare: () => void;
  onClose: () => void;
};

function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.off, true: theme.colors.redDim }}
        thumbColor={value ? theme.colors.redBright : theme.colors.textDim}
      />
    </View>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [txt, setTxt] = useState(String(value));
  const commit = () => {
    const n = parseFloat(txt.replace(',', '.'));
    onChange(Number.isFinite(n) ? n : 0);
  };
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={txt}
        onChangeText={setTxt}
        onBlur={commit}
        onSubmitEditing={commit}
        keyboardType="numeric"
        returnKeyType="done"
        placeholderTextColor={theme.colors.textDim}
      />
    </View>
  );
}

/** Whole MP above 10, one decimal below, empty when the API gave nothing. */
function mpLabel(mp: number): string {
  return mp > 0 ? `${mp >= 10 ? Math.round(mp) : Math.round(mp * 10) / 10} MP` : '';
}

/** Capture size the API offers; the maximum-resolution (50/200 MP) mode in brackets when it differs. */
function lensMp(l: LensInfo): string {
  const def = l.maxJpegMp > 0 ? l.maxJpegMp : l.pixelArrayMp;
  return l.maxResJpegMp > def ? `${mpLabel(def)} (máx ${mpLabel(l.maxResJpegMp)})` : mpLabel(def);
}

function lensLabel(l: LensInfo): string {
  const mm = l.focalLengths.length ? `${l.focalLengths.map((f) => f.toFixed(1)).join('/')} mm` : l.id;
  return [mm, lensMp(l), l.isLogical ? 'multi' : ''].filter(Boolean).join(' · ');
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** Third-stop selector: Auto first, then the stops the chosen camera supports. */
function StopPicker({
  label,
  values,
  value,
  format,
  onChange,
}: {
  label: string;
  values: number[];
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  // The hint is the supported range: taken from the clipped ladder so it matches the chips.
  const range = values.length ? `${format(values[0])} – ${format(values[values.length - 1])}` : '';
  return (
    <View style={styles.picker}>
      <Text style={styles.label}>
        {label}
        {range ? `  ${range}` : ''}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chips}>
          <Chip label={t('options.auto')} on={value <= 0} onPress={() => onChange(0)} />
          {values.map((v) => (
            <Chip key={v} label={format(v)} on={value === v} onPress={() => onChange(v)} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function OptionsPanel({ visible, prefs, lenses, onChange, onShare, onClose }: Props) {
  // Range hint + stop ladder come from the chosen lens; fall back to the default back camera.
  const lens = lenses.find((l) => l.id === prefs.lensId) ?? lenses.find((l) => l.facing === 'back');
  if (!visible) return null;
  return (
    <View style={styles.overlay}>
      <View style={styles.panel}>
        <Text style={styles.title}>{t('options.title')}</Text>
        <Toggle
          label={t('options.saveJpegs')}
          value={prefs.saveJpegs}
          onValueChange={(v) => onChange({ saveJpegs: v })}
        />
        <Toggle
          label={t('options.saveTraces')}
          value={prefs.saveTraces}
          onValueChange={(v) => onChange({ saveTraces: v })}
        />
        <Toggle
          label={t('options.nightMode')}
          value={prefs.nightMode}
          onValueChange={(v) => onChange({ nightMode: v })}
        />
        <Toggle
          label={t('options.gtiReticle')}
          value={prefs.gtiReticle}
          onValueChange={(v) => onChange({ gtiReticle: v })}
        />
        <Text style={styles.section}>{t('options.lens')}</Text>
        <View style={styles.chips}>
          <Chip
            label={t('options.lensAuto')}
            on={prefs.lensId === ''}
            onPress={() => onChange({ lensId: '' })}
          />
          {lenses.map((l) => (
            <Chip
              key={l.id}
              label={lensLabel(l)}
              on={prefs.lensId === l.id}
              onPress={() => onChange({ lensId: l.id })}
            />
          ))}
        </View>
        <Toggle
          label={t('options.infinityFocus')}
          value={prefs.infinityFocus}
          onValueChange={(v) => onChange({ infinityFocus: v })}
        />
        <Text style={styles.section}>{t('options.advanced')}</Text>
        <StopPicker
          label={t('options.iso')}
          values={isoStops(lens?.isoRange[0] ?? 0, lens?.isoRange[1] ?? 0)}
          value={prefs.iso}
          format={String}
          onChange={(v) => onChange({ iso: v })}
        />
        <StopPicker
          label={t('options.exposureSec')}
          values={shutterStops(
            lens?.exposureTimeRangeNs[0] ?? 0,
            lens?.exposureTimeRangeNs[1] ?? 0,
          )}
          value={prefs.exposureSec}
          format={formatShutter}
          onChange={(v) => onChange({ exposureSec: v })}
        />
        <Text style={styles.hint}>{t('options.manualHint')}</Text>
        <NumberField
          label={t('options.pxPerDeg')}
          value={prefs.pxPerDeg}
          onChange={(v) => onChange({ pxPerDeg: v })}
        />
        <NumberField
          label={t('options.tolDeg')}
          value={prefs.tolDeg}
          onChange={(v) => onChange({ tolDeg: v })}
        />
        <NumberField
          label={t('options.calibFrames')}
          value={prefs.calibFrames}
          onChange={(v) => onChange({ calibFrames: Math.max(1, Math.round(v)) })}
        />
        <Text style={styles.hint}>{t('options.hint')}</Text>
        <View style={styles.actions}>
          <Pressable style={styles.btn} onPress={onShare}>
            <Text style={styles.btnText}>{t('options.share')}</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={onClose}>
            <Text style={styles.btnText}>{t('options.close')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  panel: {
    backgroundColor: theme.colors.panel,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.space(2),
    width: '86%',
    gap: theme.space(1),
  },
  title: {
    color: theme.colors.redBright,
    fontFamily: theme.mono,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: theme.space(0.5),
  },
  section: {
    color: theme.colors.redDim,
    fontFamily: theme.mono,
    fontSize: 11,
    letterSpacing: 1,
    marginTop: theme.space(0.5),
  },
  picker: {
    gap: theme.space(0.5),
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(0.5),
  },
  chip: {
    borderColor: theme.colors.off,
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: theme.space(1),
    paddingHorizontal: theme.space(1.5),
  },
  chipOn: {
    borderColor: theme.colors.redBright,
  },
  chipText: {
    color: theme.colors.textDim,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  chipTextOn: {
    color: theme.colors.redBright,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space(1),
  },
  label: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
    flexShrink: 1,
  },
  input: {
    color: theme.colors.redBright,
    fontFamily: theme.mono,
    fontSize: 12,
    borderColor: theme.colors.line,
    borderWidth: 1,
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: theme.space(1),
    minWidth: 72,
    textAlign: 'right',
  },
  hint: {
    color: theme.colors.textDim,
    fontFamily: theme.mono,
    fontSize: 11,
    marginTop: theme.space(0.5),
  },
  actions: {
    flexDirection: 'row',
    gap: theme.space(1),
    marginTop: theme.space(1),
  },
  btn: {
    flex: 1,
    borderColor: theme.colors.redDim,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: theme.space(1),
    alignItems: 'center',
  },
  btnText: {
    color: theme.colors.text,
    fontFamily: theme.mono,
    fontSize: 12,
    fontWeight: '700',
  },
});
