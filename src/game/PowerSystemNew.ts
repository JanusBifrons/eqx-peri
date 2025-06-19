import { Assembly } from './Assembly';

export interface PowerAllocation {
    engines: number;
    weapons: number;
    sensors: number;
}

export interface ShipPowerAnalysis {
    totalPowerCells: number;
    maxEngines: number;
    maxWeapons: number;
    maxSensors: number;
    cockpitBackupPower: number;
}

export class PowerSystem {
    private static instance: PowerSystem;
    private playerAssembly: Assembly | null = null;
    private powerAllocation: PowerAllocation = {
        engines: 0,
        weapons: 0,
        sensors: 0
    };

    private constructor() { }

    public static getInstance(): PowerSystem {
        if (!PowerSystem.instance) {
            PowerSystem.instance = new PowerSystem();
        }
        return PowerSystem.instance;
    }    public setPlayerAssembly(assembly: Assembly | null): void {
        // Only auto-allocate power if the assembly actually changed
        const assemblyChanged = this.playerAssembly !== assembly;
        this.playerAssembly = assembly;
        if (assembly && assemblyChanged) {
            // Auto-allocate power when new player ship is set
            this.autoAllocateInitialPower();
        }
    }

    private autoAllocateInitialPower(): void {
        if (!this.playerAssembly) return;

        const analysis = this.analyzeShipPower();

        // Default engines to fully powered
        const enginePower = Math.min(analysis.maxEngines, analysis.totalPowerCells);
        const remainingPower = analysis.totalPowerCells - enginePower;

        // Allocate remaining power to weapons first, then sensors
        const weaponPower = Math.min(analysis.maxWeapons, remainingPower);
        const finalRemaining = remainingPower - weaponPower;
        const sensorPower = Math.min(analysis.maxSensors, finalRemaining);

        this.powerAllocation = {
            engines: enginePower,
            weapons: weaponPower,
            sensors: sensorPower
        };
    }

    public analyzeShipPower(): ShipPowerAnalysis {
        if (!this.playerAssembly) {
            return {
                totalPowerCells: 0,
                maxEngines: 0,
                maxWeapons: 0,
                maxSensors: 0,
                cockpitBackupPower: 0
            };
        }

        const entities = this.playerAssembly.entities.filter(e => !e.destroyed);

        // Count power cells (only non-destroyed ones provide power)
        const powerCells = entities.filter(e =>
            e.type === 'PowerCell' || e.type === 'LargePowerCell' || e.type === 'PowerReactor'
        ).length;

        // Count engines
        const engines = entities.filter(e =>
            e.type === 'Engine' || e.type === 'LargeEngine' || e.type === 'CapitalEngine'
        ).length;

        // Count weapons
        const weapons = entities.filter(e =>
            e.type === 'Gun' || e.type === 'LargeGun' || e.type === 'CapitalWeapon'
        ).length;

        // Count sensors (for now, just 1 max - future feature)
        const maxSensors = 1;

        // Cockpit backup power based on cockpit size
        const cockpits = entities.filter(e =>
            e.type === 'Cockpit' || e.type === 'LargeCockpit' || e.type === 'CapitalCore'
        );

        let cockpitBackupPower = 0;
        cockpits.forEach(cockpit => {
            if (cockpit.type === 'Cockpit') cockpitBackupPower += 2;
            else if (cockpit.type === 'LargeCockpit') cockpitBackupPower += 4;
            else if (cockpit.type === 'CapitalCore') cockpitBackupPower += 8;
        });

        return {
            totalPowerCells: powerCells + cockpitBackupPower,
            maxEngines: engines,
            maxWeapons: weapons,
            maxSensors: maxSensors,
            cockpitBackupPower: cockpitBackupPower
        };
    }

    public setPowerAllocation(allocation: PowerAllocation): void {
        const analysis = this.analyzeShipPower();

        // Validate allocation doesn't exceed limits
        const totalAllocated = allocation.engines + allocation.weapons + allocation.sensors;
        if (totalAllocated <= analysis.totalPowerCells &&
            allocation.engines <= analysis.maxEngines &&
            allocation.weapons <= analysis.maxWeapons &&
            allocation.sensors <= analysis.maxSensors) {

            this.powerAllocation = { ...allocation };
        }
    }

    public getPowerAllocation(): PowerAllocation {
        return { ...this.powerAllocation };
    }

    public getSystemPower(system: keyof PowerAllocation): number {
        return this.powerAllocation[system];
    }

    public getAvailablePower(): number {
        const analysis = this.analyzeShipPower();
        const totalAllocated = this.powerAllocation.engines +
            this.powerAllocation.weapons +
            this.powerAllocation.sensors;
        return analysis.totalPowerCells - totalAllocated;
    }

    public getTotalPowerCells(): number {
        const analysis = this.analyzeShipPower();
        return analysis.totalPowerCells;
    }

    public getMaxPowerForSystem(system: keyof PowerAllocation): number {
        const analysis = this.analyzeShipPower();
        switch (system) {
            case 'engines': return analysis.maxEngines;
            case 'weapons': return analysis.maxWeapons;
            case 'sensors': return analysis.maxSensors;
            default: return 0;
        }
    }

    // Power multipliers for gameplay effects
    public getEngineEfficiency(): number {
        const analysis = this.analyzeShipPower();
        if (analysis.maxEngines === 0) return 0;
        return this.powerAllocation.engines / analysis.maxEngines;
    }

    public getWeaponEfficiency(): number {
        const analysis = this.analyzeShipPower();
        if (analysis.maxWeapons === 0) return 0;
        return this.powerAllocation.weapons / analysis.maxWeapons;
    }

    public getSensorEfficiency(): number {
        const analysis = this.analyzeShipPower();
        if (analysis.maxSensors === 0) return 0;
        return this.powerAllocation.sensors / analysis.maxSensors;
    }

    // Weapon firing is only allowed if weapons have power
    public canFireWeapons(): boolean {
        return this.powerAllocation.weapons > 0;
    }

    // Engine thrust is only allowed if engines have power
    public canUseThrusters(): boolean {
        return this.powerAllocation.engines > 0;
    }

    // Method to update power allocation when ship components are destroyed
    public updatePowerAfterDamage(): void {
        if (!this.playerAssembly) return;

        const analysis = this.analyzeShipPower();

        // Reduce power allocation if we don't have enough power cells or components
        this.powerAllocation.engines = Math.min(
            this.powerAllocation.engines,
            Math.min(analysis.maxEngines, analysis.totalPowerCells)
        );

        this.powerAllocation.weapons = Math.min(
            this.powerAllocation.weapons,
            Math.min(analysis.maxWeapons, analysis.totalPowerCells - this.powerAllocation.engines)
        );

        this.powerAllocation.sensors = Math.min(
            this.powerAllocation.sensors,
            Math.min(analysis.maxSensors, analysis.totalPowerCells - this.powerAllocation.engines - this.powerAllocation.weapons)
        );
    }
}
