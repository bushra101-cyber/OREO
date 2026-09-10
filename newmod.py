import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
import m2cgen as m2c

# ==========================================
# STEP 1: Process Air Quality Dataset
# ==========================================
print("Loading air dataset...")
air_df = pd.read_csv("air_quality.csv")

# Select exact columns: 'temp', 'hum', 'mq'
air_clean = air_df[['temp', 'hum', 'mq']].copy()
air_clean.columns = ['Temperature', 'Humidity', 'MQ5']

# Clean nulls and cast to float
air_clean = air_clean.dropna().astype(float).reset_index(drop=True)
rover_df = air_clean[
    (air_clean['Temperature'].between(0.0, 60.0)) & 
    (air_clean['Humidity'].between(10.0, 100.0)) &
    (air_clean['MQ5'] >= 0.0)
].copy().reset_index(drop=True)


# ==========================================
# STEP 2: Synthesize Distance Feature
# ==========================================
n_total = len(rover_df)

# Default clear distance values (cm)
rover_df['Distance'] = np.random.normal(90.0, 20.0, size=n_total).clip(30.0, 200.0)


# ==========================================
# STEP 3: Inject Hazard Spikes & Balance Data
# ==========================================
# Inject Gas Hazard into ~20% of rows (MQ5 > 550)
gas_indices = np.random.choice(n_total, size=int(n_total * 0.20), replace=False)
rover_df.loc[gas_indices, 'MQ5'] = np.random.uniform(580.0, 850.0, size=len(gas_indices))

# Inject High Heat / Extreme Temp Hazard into ~15% of rows (Temp > 42.0°C)
heat_indices = np.random.choice(n_total, size=int(n_total * 0.15), replace=False)
rover_df.loc[heat_indices, 'Temperature'] = np.random.uniform(43.0, 55.0, size=len(heat_indices))

# Inject Cave-in / Blockage into ~15% of rows (Distance < 25 cm)
block_indices = np.random.choice(n_total, size=int(n_total * 0.15), replace=False)
rover_df.loc[block_indices, 'Distance'] = np.random.uniform(5.0, 24.5, size=len(block_indices))


# ==========================================
# STEP 4: Assign Hazard Labels
# ==========================================
def assign_hazard_label(row):
    if row['MQ5'] > 550.0:
        return 1  # Gas Hazard
    if row['Temperature'] > 42.0:
        return 2  # Extreme Heat / Environmental Hazard
    if row['Distance'] < 25.0:
        return 3  # Blockage / Cave-in
    return 0      # Safe

rover_df['Hazard_Label'] = rover_df.apply(assign_hazard_label, axis=1).astype(int)


# ==========================================
# STEP 5: Save Clean Training File
# ==========================================
output_filename = "mine_rover_training_data.csv"
rover_df.to_csv(output_filename, index=False)

print(f"\nSuccessfully saved {len(rover_df)} rows to '{output_filename}'")
print("\nFirst 5 rows:")
print(rover_df.head())
print("\nBalanced Class Distribution:")
print(rover_df['Hazard_Label'].value_counts())


# ==========================================
# STEP 6: Train and Export Model for ESP32
# ==========================================
# 1. Feature selection without 'ph'
features = ['Temperature', 'Humidity', 'MQ5', 'Distance']
X = rover_df[features]
y = rover_df['Hazard_Label']

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# 2. Train lightweight Random Forest
model = RandomForestClassifier(n_estimators=25, max_depth=5, random_state=42)
model.fit(X_train, y_train)

# 3. Evaluate
y_pred = model.predict(X_test)
print(f"\nModel Test Accuracy: {accuracy_score(y_test, y_pred) * 100:.2f}%\n")
print("Classification Report:")
print(classification_report(y_test, y_pred, target_names=['Safe', 'Gas', 'Heat', 'Blockage']))

# 4. Export to pure C header
c_code = m2c.export_to_c(model)

with open("mine_hazard_model.h", "w") as f:
    f.write(c_code)

print("Saved pure C model to 'mine_hazard_model2.h'.")