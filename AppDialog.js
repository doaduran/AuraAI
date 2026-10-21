import React, { useState } from 'react';
import { Alert, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Platform } from 'react-native';

// Button callbacks run directly in the click handler, preserving web file-picker access.
export function useAppDialog(lang) {
  const [dialog, setDialog] = useState(null);
  const showAlert = (title, message, buttons) => {
    if (Platform.OS !== 'web') return Alert.alert(title, message, buttons);
    setDialog({ title, message, buttons: buttons?.length ? buttons : [{ text: lang === 'tr' ? 'Tamam' : 'OK' }] });
  };
  const dialogView = (
    <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={() => setDialog(null)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <View accessibilityViewIsModal style={{ width: '100%', maxWidth: 420, maxHeight: '85%', backgroundColor: '#FFF', borderRadius: 24, padding: 24 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: '#1C1B1A' }}>{dialog?.title}</Text>
          {!!dialog?.message && <Text style={{ fontSize: 14, lineHeight: 22, color: '#7A6856', marginTop: 10 }}>{dialog.message}</Text>}
          <ScrollView style={{ flexGrow: 0, marginTop: 16 }}>
            {dialog?.buttons.map((button, index) => (
              <TouchableOpacity key={index} accessibilityRole="button" onPress={() => {
                setDialog(null);
                button.onPress?.();
              }} style={{ padding: 16, borderRadius: 12, backgroundColor: '#FAF8F5', marginBottom: 8 }}>
                <Text style={{ color: button.style === 'destructive' ? '#B42318' : '#1C1B1A', fontWeight: '600' }}>{button.text}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
  return { showAlert, dialogView };
}
