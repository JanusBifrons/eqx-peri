export interface PowerAllocation {
    engines: number;
    weapons: number;
    sensors: number;
}

export class PowerSystem {
    private static instance: PowerSystem;
    private powerAllocation: PowerAllocation = {
        engines: 0,
        weapons: 0,
        sensors: 0
    };

    private readonly maxPower = {
        engines: 4,
        weapons: 3,
        sensors: 1
    };

    private readonly totalPowerCells = 8;

    private constructor() { }

    public static getInstance(): PowerSystem {
        if (!PowerSystem.instance) {
            PowerSystem.instance = new PowerSystem();
        }
        return PowerSystem.instance;
    }

    public setPowerAllocation(allocation: PowerAllocation): void {
        // Validate allocation doesn't exceed limits
        const totalAllocated = allocation.engines + allocation.weapons + allocation.sensors;
        if (totalAllocated <= this.totalPowerCells &&
            allocation.engines <= this.maxPower.engines &&
            allocation.weapons <= this.maxPower.weapons &&
            allocation.sensors <= this.maxPower.sensors) {

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
        const totalAllocated = this.powerAllocation.engines +
            this.powerAllocation.weapons +
            this.powerAllocation.sensors;
        return this.totalPowerCells - totalAllocated;
    }

    public getTotalPowerCells(): number {
        return this.totalPowerCells;
    }

    public getMaxPowerForSystem(system: keyof PowerAllocation): number {
        return this.maxPower[system];
    }

    // Power multipliers for gameplay effects
    public getEngineEfficiency(): number {
        // 0 power = 0% efficiency, max power = 100% efficiency
        return this.powerAllocation.engines / this.maxPower.engines;
    }

    public getWeaponEfficiency(): number {
        // 0 power = 0% efficiency, max power = 100% efficiency
        return this.powerAllocation.weapons / this.maxPower.weapons;
    }

    public getSensorEfficiency(): number {
        // 0 power = 0% efficiency, max power = 100% efficiency
        return this.powerAllocation.sensors / this.maxPower.sensors;
    }

    // Weapon firing is only allowed if weapons have power
    public canFireWeapons(): boolean {
        return this.powerAllocation.weapons > 0;
    }

    // Engine thrust is only allowed if engines have power
    public canUseThrusters(): boolean {
        return this.powerAllocation.engines > 0;
    }
}
